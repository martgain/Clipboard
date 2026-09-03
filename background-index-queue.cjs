function normalizeQueueError(error) {
  return error instanceof Error ? error : new Error(String(error));
}

class BackgroundIndexQueue {
  constructor({ concurrency = 1 } = {}) {
    if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
      throw new TypeError("Queue concurrency must be a positive integer");
    }

    this.concurrency = concurrency;
    this.pending = new Map();
    this.runningKeys = new Set();
    this.activeCount = 0;
    this.scheduled = false;
    this.closed = false;
    this.closePromise = null;
    this.errors = [];
    this.idleWaiters = [];
  }

  enqueue(key, work) {
    if (this.closed) {
      return Promise.reject(new Error("Background index queue is closed"));
    }
    if (typeof key !== "string" || key.length === 0 || typeof work !== "function") {
      return Promise.reject(new TypeError("Queue key and work function are required"));
    }

    return new Promise((resolve, reject) => {
      const existing = this.pending.get(key);
      if (existing) {
        existing.work = work;
        existing.waiters.push({ resolve, reject });
        return;
      }

      this.pending.set(key, { key, work, waiters: [{ resolve, reject }] });
      this.schedulePump();
    });
  }

  flush() {
    if (this.isIdle()) {
      return this.settleFlush();
    }

    return new Promise((resolve, reject) => {
      this.idleWaiters.push({ resolve, reject });
    });
  }

  close() {
    if (!this.closePromise) {
      this.closed = true;
      this.closePromise = this.flush();
    }
    return this.closePromise;
  }

  schedulePump() {
    if (this.scheduled) {
      return;
    }

    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      this.pump();
    });
  }

  pump() {
    while (this.activeCount < this.concurrency) {
      const nextEntry = this.takeNextEntry();
      if (!nextEntry) {
        break;
      }
      void this.runEntry(nextEntry);
    }

    this.resolveIdleWaiters();
  }

  takeNextEntry() {
    for (const [key, entry] of this.pending) {
      if (this.runningKeys.has(key)) {
        continue;
      }

      this.pending.delete(key);
      this.runningKeys.add(key);
      this.activeCount += 1;
      return entry;
    }

    return null;
  }

  async runEntry(entry) {
    try {
      await entry.work();
      entry.waiters.forEach(({ resolve }) => resolve());
    } catch (error) {
      const queueError = normalizeQueueError(error);
      this.errors.push(queueError);
      entry.waiters.forEach(({ reject }) => reject(queueError));
    } finally {
      this.activeCount -= 1;
      this.runningKeys.delete(entry.key);
      this.pump();
    }
  }

  isIdle() {
    return !this.scheduled && this.activeCount === 0 && this.pending.size === 0;
  }

  settleFlush() {
    const [firstError] = this.errors.splice(0);
    return firstError ? Promise.reject(firstError) : Promise.resolve();
  }

  resolveIdleWaiters() {
    if (!this.isIdle() || this.idleWaiters.length === 0) {
      return;
    }

    const [firstError] = this.errors.splice(0);
    const waiters = this.idleWaiters.splice(0);
    waiters.forEach(({ resolve, reject }) => {
      if (firstError) {
        reject(firstError);
      } else {
        resolve();
      }
    });
  }
}

module.exports = { BackgroundIndexQueue };
