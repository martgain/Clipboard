const fs = require("node:fs");
const path = require("node:path");

const ENTRY_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,200}$/;
const DEFAULT_MAX_TEXT_LENGTH = 100000;

function cloneEntry(entry) {
  return { ...entry };
}

function normalizeEntry(rawEntry, maxTextLength) {
  if (!rawEntry || typeof rawEntry !== "object"
    || typeof rawEntry.entryId !== "string" || !ENTRY_ID_PATTERN.test(rawEntry.entryId)
    || typeof rawEntry.text !== "string" || rawEntry.text.trim().length === 0
    || rawEntry.text.length > maxTextLength) {
    throw new TypeError("OCR index entry must contain a safe id and non-empty text");
  }

  return {
    entryId: rawEntry.entryId,
    text: rawEntry.text,
    language: typeof rawEntry.language === "string" ? rawEntry.language.slice(0, 40) : null,
    engine: typeof rawEntry.engine === "string" ? rawEntry.engine.slice(0, 40) : null,
    confidence: Number.isFinite(rawEntry.confidence) ? Math.min(1, Math.max(0, rawEntry.confidence)) : null,
    capturedAt: Number.isFinite(rawEntry.capturedAt) ? rawEntry.capturedAt : null,
    updatedAt: Number.isFinite(rawEntry.updatedAt) ? rawEntry.updatedAt : Date.now()
  };
}

class OcrIndex {
  constructor({ filePath = null, maxTextLength = DEFAULT_MAX_TEXT_LENGTH, persistQueue = null } = {}) {
    if (persistQueue !== null && (typeof persistQueue !== "object" || typeof persistQueue.enqueue !== "function")) {
      throw new TypeError("OCR index persistence queue must provide enqueue");
    }

    this.filePath = filePath;
    this.maxTextLength = Number.isInteger(maxTextLength) ? Math.max(1, maxTextLength) : DEFAULT_MAX_TEXT_LENGTH;
    this.persistQueue = persistQueue;
    this.entries = new Map();
    this.loaded = false;
  }

  async ensureLoaded() {
    if (this.loaded) {
      return;
    }

    this.loaded = true;
    if (!this.filePath) {
      return;
    }

    try {
      const raw = JSON.parse(await fs.promises.readFile(this.filePath, "utf8"));
      (Array.isArray(raw?.entries) ? raw.entries : []).forEach((entry) => {
        try {
          const normalized = normalizeEntry(entry, this.maxTextLength);
          this.entries.set(normalized.entryId, normalized);
        } catch {
          // Ignore one malformed OCR record and keep the remaining index usable.
        }
      });
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  async upsert(entry) {
    await this.ensureLoaded();
    const normalized = normalizeEntry(entry, this.maxTextLength);
    this.entries.set(normalized.entryId, normalized);
    await this.persist();
    return cloneEntry(normalized);
  }

  search(query) {
    const needle = typeof query === "string" ? query.trim().toLocaleLowerCase() : "";
    if (!needle) {
      return [];
    }

    return [...this.entries.values()]
      .filter((entry) => entry.text.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map(cloneEntry);
  }

  async rebuild(entries) {
    await this.ensureLoaded();
    const rebuilt = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const normalized = normalizeEntry(entry, this.maxTextLength);
      rebuilt.set(normalized.entryId, normalized);
    });
    this.entries = rebuilt;
    await this.persist();
    return { count: rebuilt.size };
  }

  async remove(entryId) {
    await this.ensureLoaded();
    const removed = this.entries.delete(entryId);
    if (removed) {
      await this.persist();
    }
    return removed;
  }

  async persist() {
    if (!this.filePath) {
      return;
    }

    const writePersisted = async () => {
      await this.writePersisted();
    };

    if (this.persistQueue) {
      return this.persistQueue.enqueue("ocr-index", writePersisted);
    }

    return writePersisted();
  }

  async writePersisted() {
    if (!this.filePath) {
      return;
    }

    const directory = path.dirname(this.filePath);
    await fs.promises.mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    const payload = JSON.stringify({ version: 1, entries: [...this.entries.values()] }, null, 2);
    await fs.promises.writeFile(temporaryPath, payload, "utf8");
    await fs.promises.rename(temporaryPath, this.filePath);
  }
}

module.exports = { OcrIndex, normalizeEntry, DEFAULT_MAX_TEXT_LENGTH };
