const { normalizeOcrText } = require("../../../ocr-text.cjs");

const DEFAULT_INTERVAL_MS = 500;

class SubtitleSession {
  constructor({
    capture,
    recognize,
    onLine = () => {},
    onError = () => {},
    intervalMs = DEFAULT_INTERVAL_MS,
    now = () => Date.now(),
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval
  } = {}) {
    if (typeof capture !== "function" || typeof recognize !== "function") {
      throw new TypeError("Subtitle session requires capture and recognize functions");
    }

    this.capture = capture;
    this.recognize = recognize;
    this.onLine = onLine;
    this.onError = onError;
    this.intervalMs = Number.isFinite(intervalMs) ? Math.max(100, intervalMs) : DEFAULT_INTERVAL_MS;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.status = "stopped";
    this.timer = null;
    this.scanning = false;
    this.lastLine = null;
  }

  start() {
    if (this.status === "running") {
      return false;
    }

    this.status = "running";
    this.lastLine = null;
    this.timer = this.setIntervalFn(() => {
      void this.scan();
    }, this.intervalMs);
    return true;
  }

  pause() {
    if (this.status !== "running") {
      return false;
    }

    this.status = "paused";
    this.clearTimer();
    return true;
  }

  resume() {
    if (this.status !== "paused") {
      return false;
    }

    this.status = "running";
    this.timer = this.setIntervalFn(() => {
      void this.scan();
    }, this.intervalMs);
    return true;
  }

  stop() {
    const wasActive = this.status !== "stopped";
    this.status = "stopped";
    this.clearTimer();
    this.lastLine = null;
    return wasActive;
  }

  scan() {
    if (this.status !== "running" || this.scanning) {
      return false;
    }

    this.scanning = true;
    return this.performScan();
  }

  async performScan() {
    try {
      const capture = await this.capture();
      if (this.status === "stopped" || !capture) {
        return false;
      }

      const recognition = await this.recognize(capture);
      const text = normalizeOcrText(typeof recognition === "string" ? recognition : recognition?.text || "");
      if (this.status === "stopped" || !text || text === this.lastLine) {
        return false;
      }

      this.lastLine = text;
      this.onLine({
        text,
        capturedAt: this.now(),
        confidence: Number.isFinite(recognition?.confidence) ? recognition.confidence : null,
        engine: recognition?.engine || null,
        warnings: Array.isArray(recognition?.warnings) ? [...recognition.warnings] : []
      });
      return true;
    } catch (error) {
      this.onError(error);
      return false;
    } finally {
      this.scanning = false;
    }
  }

  clearTimer() {
    if (this.timer !== null) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }
}

module.exports = { SubtitleSession, DEFAULT_INTERVAL_MS };
