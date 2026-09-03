const fs = require("node:fs");
const childProcess = require("node:child_process");

const DEFAULT_MAX_JSON_LINE_BYTES = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 4000;
const DEFAULT_STARTUP_TIMEOUT_MS = 4000;
const DEFAULT_STOP_TIMEOUT_MS = 2000;
const HELPER_ARGS = Object.freeze(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"]);

function asErrorDetails(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "ERROR",
    message: typeof error?.message === "string" ? error.message : String(error)
  };
}

class KeyboardLockClient {
  constructor({
    platform = process.platform,
    helperPath = null,
    spawn = childProcess.spawn,
    existsSync = fs.existsSync,
    maxJsonLineBytes = DEFAULT_MAX_JSON_LINE_BYTES,
    commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
    stopTimeoutMs = DEFAULT_STOP_TIMEOUT_MS,
    setTimeout = globalThis.setTimeout,
    clearTimeout = globalThis.clearTimeout,
    onStateChange = null,
    logger = null
  } = {}) {
    if (typeof platform !== "string" || platform.length === 0) {
      throw new TypeError("Keyboard lock client platform is required");
    }
    if (typeof spawn !== "function" || typeof existsSync !== "function") {
      throw new TypeError("Keyboard lock helper process dependencies are required");
    }
    if (onStateChange !== null && typeof onStateChange !== "function") {
      throw new TypeError("Keyboard lock state change callback must be a function");
    }
    if (logger !== null && typeof logger !== "function") {
      throw new TypeError("Keyboard lock logger must be a function");
    }

    this.platform = platform;
    this.helperPath = helperPath;
    this.spawn = spawn;
    this.existsSync = existsSync;
    this.maxJsonLineBytes = maxJsonLineBytes;
    this.commandTimeoutMs = commandTimeoutMs;
    this.startupTimeoutMs = startupTimeoutMs;
    this.stopTimeoutMs = stopTimeoutMs;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.onStateChange = onStateChange;
    this.logger = logger;

    this.mode = "stopped";
    this.locked = false;
    this.reason = null;
    this.lastError = null;
    this.child = null;
    this.pending = "";
    this.startResolvers = [];
    this.pendingSetResolvers = [];
    this.startTimer = null;
    this.pendingSetTimer = null;
  }

  getStatus() {
    return { mode: this.mode, locked: this.locked, reason: this.reason, lastError: this.lastError };
  }

  _log(error) {
    this.lastError = asErrorDetails(error);
    if (this.logger) {
      try {
        this.logger(this.lastError);
      } catch {
        // Diagnostics must not take down the keyboard lock control.
      }
    }
  }

  _notify() {
    if (typeof this.onStateChange === "function") {
      try {
        this.onStateChange(this.getStatus());
      } catch {
        // A broken renderer listener must not disrupt the lock lifecycle.
      }
    }
  }

  _resolvePendingStarts() {
    const resolvers = this.startResolvers;
    this.startResolvers = [];
    resolvers.forEach((resolve) => resolve(this.getStatus()));
  }

  _clearStartTimer() {
    if (this.startTimer !== null) {
      this.clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  _resolvePendingSets() {
    if (this.pendingSetTimer !== null) {
      this.clearTimeout(this.pendingSetTimer);
      this.pendingSetTimer = null;
    }
    const resolvers = this.pendingSetResolvers;
    this.pendingSetResolvers = [];
    resolvers.forEach((resolve) => resolve(this.getStatus()));
  }

  _fail(reason, error = null) {
    this._clearStartTimer();
    if (error) {
      this._log(error);
    } else {
      this.lastError = { code: reason, message: reason };
    }
    this.mode = "error";
    this.locked = false;
    this.reason = reason;
    this._resolvePendingStarts();
    this._resolvePendingSets();
    this._notify();
  }

  async start() {
    if (this.mode === "ready") {
      return this.getStatus();
    }
    if (this.mode === "starting") {
      return new Promise((resolve) => this.startResolvers.push(resolve));
    }

    if (this.platform !== "win32") {
      this._fail("unsupported-platform");
      return this.getStatus();
    }
    if (!this.helperPath || !this._helperExists()) {
      this._fail("helper-not-found");
      return this.getStatus();
    }

    this.mode = "starting";
    this.reason = null;
    this.lastError = null;

    return new Promise((resolve) => {
      this.startResolvers.push(resolve);

      let child;
      try {
        child = this.spawn("powershell.exe", [...HELPER_ARGS, "-File", this.helperPath], {
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true
        });
      } catch (error) {
        this._fail("helper-start-failed", error);
        return;
      }

      if (!child || typeof child !== "object") {
        this._fail("helper-start-failed", new Error("Keyboard lock helper process was not created"));
        return;
      }

      this.child = child;
      this._attach(child);
      this.startTimer = this.setTimeout(() => {
        const timedOutChild = this.child;
        this.child = null;
        this._fail("startup-timeout");
        if (timedOutChild && typeof timedOutChild.kill === "function") {
          try {
            timedOutChild.kill();
          } catch (error) {
            this._log(error);
          }
        }
      }, this.startupTimeoutMs);
    });
  }

  _helperExists() {
    try {
      return Boolean(this.existsSync(this.helperPath));
    } catch (error) {
      this._log(error);
      return false;
    }
  }

  _attach(child) {
    if (child.stdout && typeof child.stdout.on === "function") {
      child.stdout.on("data", (chunk) => this._pushChunk(chunk));
    }
    if (typeof child.on === "function") {
      child.on("error", (error) => {
        if (this.mode === "stopped") {
          return;
        }
        this._fail("helper-start-failed", error);
      });
      child.on("exit", () => {
        if (this.mode === "stopped" || child !== this.child) {
          return;
        }
        const error = new Error("Keyboard lock helper exited unexpectedly");
        error.code = "KEYBOARD_LOCK_HELPER_EXITED";
        this.child = null;
        this._fail("helper-exited", error);
      });
    }
  }

  _pushChunk(chunk) {
    this.pending += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);

    let newlineIndex;
    while ((newlineIndex = this.pending.indexOf("\n")) !== -1) {
      const line = this.pending.slice(0, newlineIndex).replace(/\r$/, "");
      this.pending = this.pending.slice(newlineIndex + 1);
      this._parseLine(line);
    }

    if (Buffer.byteLength(this.pending, "utf8") > this.maxJsonLineBytes) {
      this.pending = "";
      this._fail("helper-line-too-large");
    }
  }

  _parseLine(line) {
    if (line.trim().length === 0) {
      return;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      this._fail("malformed-status", error);
      return;
    }

    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") {
      this._fail("malformed-status", new Error("Keyboard lock helper event must be an object with a type"));
      return;
    }

    this._handleEvent(event);
  }

  _handleEvent(event) {
    if (event.type === "ready") {
      this._clearStartTimer();
      this.mode = "ready";
      this.locked = false;
      this.reason = null;
      this.lastError = null;
      this._resolvePendingStarts();
      this._notify();
      return;
    }

    if (event.type === "state") {
      this.mode = "ready";
      this.locked = event.locked === true;
      this.reason = typeof event.reason === "string" ? event.reason : null;
      this.lastError = null;
      this._resolvePendingSets();
      this._notify();
      return;
    }

    if (event.type === "error") {
      this._fail(typeof event.code === "string" ? event.code : "HELPER_ERROR", new Error(typeof event.message === "string" ? event.message : "Keyboard lock helper reported an error"));
      return;
    }

    this._fail("unknown-event", new Error(`Keyboard lock helper sent an unknown event type: ${event.type}`));
  }

  async setLocked(locked) {
    if (typeof locked !== "boolean") {
      throw new TypeError("Keyboard lock state must be boolean");
    }

    if (this.mode !== "ready") {
      await this.start();
    }

    if (this.mode !== "ready" || !this.child) {
      return this.getStatus();
    }

    return new Promise((resolve) => {
      this.pendingSetResolvers.push(resolve);
      this.pendingSetTimer = this.setTimeout(() => {
        this.pendingSetTimer = null;
        this._fail("command-timeout");
      }, this.commandTimeoutMs);

      try {
        this.child.stdin.write(`${JSON.stringify({ action: "set", locked })}\n`);
      } catch (error) {
        this._fail("write-failed", error);
      }
    });
  }

  async stop() {
    if (this.mode === "stopped") {
      return this.getStatus();
    }

    this._clearStartTimer();
    const child = this.child;
    const wasReady = this.mode === "ready";
    this.mode = "stopped";
    this.locked = false;
    this.reason = null;
    this.child = null;
    this._resolvePendingStarts();
    this._resolvePendingSets();

    if (!child) {
      return this.getStatus();
    }

    if (wasReady) {
      try {
        child.stdin.write(`${JSON.stringify({ action: "set", locked: false })}\n`);
        child.stdin.write(`${JSON.stringify({ action: "stop" })}\n`);
        child.stdin.end();
      } catch (error) {
        this._log(error);
      }
    }

    await this._waitForExitOrKill(child);
    return this.getStatus();
  }

  _waitForExitOrKill(child) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        this.clearTimeout(timer);
        resolve();
      };

      const timer = this.setTimeout(() => {
        try {
          child.kill();
        } catch (error) {
          this._log(error);
        }
        finish();
      }, this.stopTimeoutMs);

      if (typeof child.once === "function") {
        child.once("exit", finish);
      } else {
        finish();
      }
    });
  }
}

module.exports = Object.freeze({ KeyboardLockClient });
