const fs = require("node:fs");
const childProcess = require("node:child_process");

const DEFAULT_INITIAL_POLL_INTERVAL_MS = 350;
const DEFAULT_MAX_POLL_INTERVAL_MS = 5000;
const DEFAULT_BACKOFF_FACTOR = 2;
const DEFAULT_MAX_JSON_LINE_BYTES = 256 * 1024;

function asErrorDetails(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "ERROR",
    message: typeof error?.message === "string" ? error.message : String(error)
  };
}

function assertPositiveInteger(candidateNumber, label) {
  if (!Number.isSafeInteger(candidateNumber) || candidateNumber < 1) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
}

function validateClientPlatform(platform, helperPath, helperArgs) {
  if (typeof platform !== "string" || platform.length === 0) {
    throw new TypeError("Clipboard listener platform is required");
  }
  if (helperPath !== null && (typeof helperPath !== "string" || helperPath.trim().length === 0)) {
    throw new TypeError("Clipboard helper path must be a non-empty string");
  }
  if (!Array.isArray(helperArgs) || helperArgs.some((argument) => typeof argument !== "string")) {
    throw new TypeError("Clipboard helper arguments must be strings");
  }
}

function validateClientPolling(poll, initialInterval, maxInterval, backoffFactor) {
  if (poll !== null && typeof poll !== "function") {
    throw new TypeError("Clipboard polling fallback must be a function");
  }
  assertPositiveInteger(initialInterval, "Initial clipboard poll interval");
  assertPositiveInteger(maxInterval, "Maximum clipboard poll interval");
  if (maxInterval < initialInterval) {
    throw new RangeError("Maximum clipboard poll interval must be >= initial interval");
  }
  if (!Number.isFinite(backoffFactor) || backoffFactor < 1) {
    throw new RangeError("Clipboard poll backoff factor must be >= 1");
  }
}

function validateClientDependencies(spawn, existsSync, setTimeout, clearTimeout, logger) {
  if (typeof spawn !== "function" || typeof existsSync !== "function") {
    throw new TypeError("Clipboard helper process dependencies are required");
  }
  if (typeof setTimeout !== "function" || typeof clearTimeout !== "function") {
    throw new TypeError("Clipboard polling timer functions are required");
  }
  if (logger !== null && typeof logger !== "function") {
    throw new TypeError("Clipboard listener logger must be a function");
  }
}

class JsonLineDecoder {
  constructor({ onEvent, onError, maxLineBytes = DEFAULT_MAX_JSON_LINE_BYTES } = {}) {
    if (typeof onEvent !== "function" || typeof onError !== "function") {
      throw new TypeError("JSON line callbacks are required");
    }
    assertPositiveInteger(maxLineBytes, "JSON line byte limit");
    this.onEvent = onEvent;
    this.onError = onError;
    this.maxLineBytes = maxLineBytes;
    this.pending = "";
  }

  push(chunk) {
    if (chunk === undefined || chunk === null) {
      return;
    }

    this.pending += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    if (Buffer.byteLength(this.pending, "utf8") > this.maxLineBytes && !this.pending.includes("\n")) {
      this.pending = "";
      this.onError(new RangeError("Clipboard helper JSON line is too large"));
      return;
    }

    let newlineIndex;
    while ((newlineIndex = this.pending.indexOf("\n")) !== -1) {
      const line = this.pending.slice(0, newlineIndex).replace(/\r$/, "");
      this.pending = this.pending.slice(newlineIndex + 1);
      this._parse(line);
    }

    if (Buffer.byteLength(this.pending, "utf8") > this.maxLineBytes) {
      this.pending = "";
      this.onError(new RangeError("Clipboard helper JSON line is too large"));
    }
  }

  flush() {
    if (this.pending.length > 0) {
      const line = this.pending;
      this.pending = "";
      this._parse(line);
    }
  }

  _parse(line) {
    if (Buffer.byteLength(line, "utf8") > this.maxLineBytes) {
      this.onError(new RangeError("Clipboard helper JSON line is too large"));
      return;
    }
    if (line.trim().length === 0) {
      return;
    }

    try {
      const event = JSON.parse(line);
      if (!event || typeof event !== "object" || Array.isArray(event)) {
        throw new TypeError("Clipboard helper event must be an object");
      }
      this.onEvent(event);
    } catch (error) {
      this.onError(error);
    }
  }
}

class WindowsListenerClient {
  constructor({
    platform = process.platform,
    helperPath = null,
    helperArgs = [],
    poll = null,
    spawn = childProcess.spawn,
    existsSync = fs.existsSync,
    initialPollIntervalMs = DEFAULT_INITIAL_POLL_INTERVAL_MS,
    maxPollIntervalMs = DEFAULT_MAX_POLL_INTERVAL_MS,
    backoffFactor = DEFAULT_BACKOFF_FACTOR,
    maxJsonLineBytes = DEFAULT_MAX_JSON_LINE_BYTES,
    setTimeout = globalThis.setTimeout,
    clearTimeout = globalThis.clearTimeout,
    logger = null
  } = {}) {
    validateClientPlatform(platform, helperPath, helperArgs);
    validateClientPolling(poll, initialPollIntervalMs, maxPollIntervalMs, backoffFactor);
    assertPositiveInteger(maxJsonLineBytes, "JSON line byte limit");
    validateClientDependencies(spawn, existsSync, setTimeout, clearTimeout, logger);

    this.platform = platform;
    this.helperPath = helperPath;
    this.helperArgs = helperArgs.slice();
    this.poll = poll;
    this.spawn = spawn;
    this.existsSync = existsSync;
    this.initialPollIntervalMs = initialPollIntervalMs;
    this.maxPollIntervalMs = maxPollIntervalMs;
    this.backoffFactor = backoffFactor;
    this.maxJsonLineBytes = maxJsonLineBytes;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.logger = logger;

    this.mode = "stopped";
    this.baseMode = "stopped";
    this.helperSupported = false;
    this.reason = null;
    this.lastError = null;
    this.pollIntervalMs = initialPollIntervalMs;
    this.timer = null;
    this.child = null;
    this.onChange = null;
    this.stopped = true;
    this.paused = false;
  }

  _log(error) {
    this.lastError = asErrorDetails(error);
    if (this.logger) {
      try {
        this.logger(this.lastError);
      } catch {
        // Diagnostics must not take down clipboard monitoring.
      }
    }
  }

  _helperAvailability() {
    if (this.platform !== "win32") {
      return { supported: false, reason: "windows-only" };
    }
    if (!this.helperPath) {
      return { supported: false, reason: "helper-not-configured" };
    }

    let exists;
    try {
      exists = this.existsSync(this.helperPath);
    } catch (error) {
      this._log(error);
      return { supported: false, reason: "helper-check-failed" };
    }

    return exists ? { supported: true, reason: null } : { supported: false, reason: "helper-not-found" };
  }

  _status() {
    return {
      mode: this.mode,
      helperSupported: this.helperSupported,
      helperPath: this.helperPath,
      reason: this.reason,
      pollIntervalMs: this.baseMode === "polling" ? this.pollIntervalMs : null,
      lastError: this.lastError
    };
  }

  getStatus() {
    return this._status();
  }

  status() {
    return this.getStatus();
  }

  _deliver(clipboardEvent, expectedMode) {
    if (this.stopped || this.paused || this.baseMode !== expectedMode || typeof this.onChange !== "function") {
      return;
    }

    try {
      const callbackOutcome = this.onChange(clipboardEvent);
      if (callbackOutcome && typeof callbackOutcome.then === "function") {
        callbackOutcome.catch((error) => this._log(error));
      }
    } catch (error) {
      this._log(error);
    }
  }

  _onHelperEvent(event) {
    if (event.type === "ready" || event.type === "status") {
      return;
    }
    this._deliver(event, "helper");
  }

  _attachHelper(child) {
    if (!child.stdout || typeof child.stdout.on !== "function") {
      throw new TypeError("Clipboard helper stdout is required for JSONL events");
    }

    const decoder = new JsonLineDecoder({
      maxLineBytes: this.maxJsonLineBytes,
      onEvent: (event) => this._onHelperEvent(event),
      onError: (error) => this._log(error)
    });
    child.stdout.on("data", (chunk) => decoder.push(chunk));
    if (typeof child.stdout.on === "function") {
      child.stdout.on("end", () => decoder.flush());
    }
    if (typeof child.on === "function") {
      child.on("error", (error) => this._activateFallback("helper-error", error));
      child.on("close", (code, signal) => {
        if (!this.stopped && this.baseMode === "helper") {
          const error = new Error(`Clipboard helper exited${code === null ? "" : ` with code ${code}`}${signal ? ` (${signal})` : ""}`);
          error.code = "CLIPBOARD_HELPER_EXITED";
          this._activateFallback("helper-exited", error);
        }
      });
    }
  }

  _clearPollTimer() {
    if (this.timer !== null) {
      this.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  _schedulePoll(delay = this.pollIntervalMs) {
    if (this.stopped || this.paused || this.baseMode !== "polling" || this.poll === null) {
      return;
    }
    this._clearPollTimer();
    this.timer = this.setTimeout(() => {
      this.timer = null;
      void this.pollOnce();
    }, delay);
  }

  _increasePollInterval() {
    this.pollIntervalMs = Math.min(
      this.maxPollIntervalMs,
      Math.max(this.initialPollIntervalMs, Math.ceil(this.pollIntervalMs * this.backoffFactor))
    );
  }

  _validatePolledEvent(polledEvent) {
    if (!polledEvent || typeof polledEvent !== "object" || Array.isArray(polledEvent)) {
      throw new TypeError("Clipboard polling fallback must return an event object or null");
    }
  }

  async pollOnce() {
    if (this.stopped || this.paused || this.baseMode !== "polling" || this.poll === null) {
      return null;
    }

    let polledEvent = null;
    try {
      polledEvent = await this.poll();
      if (polledEvent !== null && polledEvent !== undefined) {
        this._validatePolledEvent(polledEvent);
        this._deliver(polledEvent, "polling");
      }
    } catch (error) {
      this._log(error);
      this.reason = "poll-failed";
    } finally {
      this._increasePollInterval();
      this._schedulePoll(this.pollIntervalMs);
    }

    return polledEvent;
  }

  _stopChild() {
    const childProcess = this.child;
    this.child = null;
    if (!childProcess || typeof childProcess.kill !== "function") {
      return;
    }
    try {
      childProcess.kill();
    } catch (error) {
      this._log(error);
    }
  }

  _activateFallback(reason, error = null) {
    if (this.stopped) {
      return;
    }

    if (error) {
      this._log(error);
    }
    this.helperSupported = false;
    this.reason = reason;
    this._stopChild();
    this.baseMode = this.poll ? "polling" : "unsupported";
    this.mode = this.paused ? "paused" : this.baseMode;
    this.pollIntervalMs = this.initialPollIntervalMs;

    if (this.baseMode === "polling") {
      this._schedulePoll(this.pollIntervalMs);
    }
  }

  _startHelper() {
    try {
      const childProcess = this.spawn(this.helperPath, this.helperArgs.slice(), {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
      if (!childProcess || typeof childProcess !== "object") {
        throw new TypeError("Clipboard helper process was not created");
      }
      this.child = childProcess;
      this.baseMode = "helper";
      this.mode = "helper";
      this._attachHelper(childProcess);
    } catch (error) {
      this._activateFallback("helper-start-failed", error);
    }
  }

  _startFallback(reason) {
    this.reason = reason;
    this.baseMode = this.poll ? "polling" : "unsupported";
    this.mode = this.baseMode;
    if (this.baseMode === "polling") {
      this._schedulePoll(this.pollIntervalMs);
    }
  }

  async start(onChange) {
    if (typeof onChange !== "function") {
      throw new TypeError("Clipboard listener callback must be a function");
    }
    if (!this.stopped) {
      this.onChange = onChange;
      return this.getStatus();
    }

    this.onChange = onChange;
    this.stopped = false;
    this.paused = false;
    this.reason = null;
    this.lastError = null;
    this.pollIntervalMs = this.initialPollIntervalMs;
    const availability = this._helperAvailability();
    this.helperSupported = availability.supported;

    if (availability.supported) {
      this._startHelper();
      return this.getStatus();
    }

    this._startFallback(availability.reason);
    return this.getStatus();
  }

  pause() {
    if (this.stopped) {
      return;
    }
    this.paused = true;
    this._clearPollTimer();
    this.mode = "paused";
  }

  resume() {
    if (this.stopped || !this.paused) {
      return;
    }
    this.paused = false;
    this.mode = this.baseMode;
    if (this.baseMode === "polling") {
      this._schedulePoll(this.pollIntervalMs);
    }
  }

  stop() {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.paused = false;
    this._clearPollTimer();
    this._stopChild();
    this.baseMode = "stopped";
    this.mode = "stopped";
  }
}

module.exports = Object.freeze({
  ClipboardMonitor: WindowsListenerClient,
  DEFAULT_BACKOFF_FACTOR,
  DEFAULT_INITIAL_POLL_INTERVAL_MS,
  DEFAULT_MAX_JSON_LINE_BYTES,
  DEFAULT_MAX_POLL_INTERVAL_MS,
  JsonLineDecoder,
  WindowsListenerClient
});
