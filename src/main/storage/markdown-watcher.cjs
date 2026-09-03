const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function fileFingerprint(filePath) {
  try {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function normalizeChangedFile(directoryPath, filename) {
  if (!filename) {
    return null;
  }

  const relativeName = filename.toString();
  const target = path.resolve(directoryPath, relativeName);
  const relative = path.relative(path.resolve(directoryPath), target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return target;
}

class MarkdownWatcher {
  constructor({ markdownFile, groupsDirectory, debounceMs = 200, onConflict } = {}) {
    if (typeof markdownFile !== "string" || markdownFile.trim().length === 0) {
      throw new TypeError("Markdown file is required");
    }

    if (groupsDirectory !== undefined && (typeof groupsDirectory !== "string" || groupsDirectory.trim().length === 0)) {
      throw new TypeError("Markdown groups directory is invalid");
    }

    if (!Number.isSafeInteger(debounceMs) || debounceMs < 0) {
      throw new RangeError("Markdown watcher debounce must be non-negative");
    }

    if (typeof onConflict !== "function") {
      throw new TypeError("Markdown watcher callback is required");
    }

    this.markdownFile = path.resolve(markdownFile);
    this.groupsDirectory = path.resolve(groupsDirectory || path.join(path.dirname(this.markdownFile), "groups"));
    this.debounceMs = debounceMs;
    this.onConflict = onConflict;
    this.watchers = [];
    this.pendingPaths = new Set();
    this.baseline = new Map();
    this.debounceTimer = null;
  }

  watchedDirectories() {
    return [...new Set([path.dirname(this.markdownFile), this.groupsDirectory])];
  }

  knownMarkdownFiles() {
    const groupFiles = fs.existsSync(this.groupsDirectory)
      ? fs.readdirSync(this.groupsDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => path.join(this.groupsDirectory, entry.name))
      : [];
    return [this.markdownFile, ...groupFiles];
  }

  refreshBaseline(paths) {
    const isFullRefresh = paths === undefined;
    const baselinePaths = [...new Set(isFullRefresh ? this.knownMarkdownFiles() : paths)]
      .map((filePath) => path.resolve(filePath));

    if (isFullRefresh) {
      const knownPaths = new Set(baselinePaths);
      [...this.baseline.keys()]
        .filter((filePath) => path.dirname(filePath) === this.groupsDirectory && !knownPaths.has(filePath))
        .forEach((filePath) => this.baseline.delete(filePath));
    }

    baselinePaths.forEach((filePath) => {
      this.baseline.set(path.resolve(filePath), fileFingerprint(filePath));
    });
  }

  markLocalWrite(paths = [this.markdownFile]) {
    this.refreshBaseline(paths);
  }

  queueChange(directoryPath, filename) {
    const target = normalizeChangedFile(directoryPath, filename);

    if (!target || (target !== this.markdownFile && path.dirname(target) !== this.groupsDirectory)) {
      return;
    }

    if (target !== this.markdownFile && !target.endsWith(".md")) {
      return;
    }

    this.pendingPaths.add(target);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this.flushChanges(), this.debounceMs);
  }

  flushChanges() {
    this.debounceTimer = null;
    const changedPaths = [...this.pendingPaths]
      .filter((filePath) => fileFingerprint(filePath) !== this.baseline.get(filePath))
      .sort();
    this.pendingPaths.clear();

    if (changedPaths.length === 0) {
      return;
    }

    this.refreshBaseline(changedPaths);
    this.onConflict({ conflict: true, paths: changedPaths });
  }

  start() {
    if (this.watchers.length > 0) {
      return;
    }

    this.refreshBaseline();
    this.watchedDirectories().forEach((directoryPath) => {
      if (!fs.existsSync(directoryPath)) {
        return;
      }

      const watcher = fs.watch(directoryPath, { persistent: false }, (_eventType, filename) => {
        this.queueChange(directoryPath, filename);
      });
      this.watchers.push(watcher);
    });
  }

  stop() {
    this.watchers.forEach((watcher) => watcher.close());
    this.watchers = [];
    this.pendingPaths.clear();
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}

module.exports = { MarkdownWatcher, fileFingerprint };
