const fs = require("node:fs");
const path = require("node:path");

const { MediaStore } = require("./media-store.cjs");

function cloneReport(report) {
  return JSON.parse(JSON.stringify(report));
}

function directoryBytes(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    return 0;
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true }).reduce((totalBytes, entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return totalBytes + directoryBytes(entryPath);
    }
    return entry.isFile() ? totalBytes + fs.statSync(entryPath).size : totalBytes;
  }, 0);
}

function countFiles(directoryPath, predicate = () => true) {
  if (!fs.existsSync(directoryPath)) {
    return 0;
  }

  return fs.readdirSync(directoryPath, { withFileTypes: true }).reduce((fileCount, entry) => {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return fileCount + countFiles(entryPath, predicate);
    }
    return entry.isFile() && predicate(entry.name) ? fileCount + 1 : fileCount;
  }, 0);
}

function imageReferences(library) {
  if (!library || !Array.isArray(library.pinned) || !Array.isArray(library.normal)) {
    return [];
  }

  const trashEntries = Array.isArray(library.trash)
    ? library.trash.map((record) => record?.entry)
    : [];

  return [...library.pinned, ...library.normal, ...trashEntries]
    .filter((entry) => entry && entry.type === "image" && entry.image && typeof entry.image === "object")
    .map((entry) => entry.image);
}

function currentGeneration(transactionDirectory) {
  const pointerPath = path.join(transactionDirectory, "current.json");

  try {
    const pointer = JSON.parse(fs.readFileSync(pointerPath, "utf8"));
    return typeof pointer.generation === "string" ? pointer.generation : null;
  } catch (error) {
    return null;
  }
}

function backupCount(backupDirectory) {
  return countFiles(backupDirectory, (name) => name === "manifest.json");
}

class StorageHealth {
  constructor({ markdownDirectory, mediaDirectory, transactionDirectory, backupDirectory, dragDirectory } = {}) {
    const directories = { markdownDirectory, mediaDirectory, transactionDirectory, backupDirectory, dragDirectory };
    if (Object.entries(directories).some(([, directory]) => typeof directory !== "string" || directory.trim().length === 0)) {
      throw new TypeError("Storage health directories are required");
    }

    this.markdownDirectory = path.resolve(markdownDirectory);
    this.mediaDirectory = path.resolve(mediaDirectory);
    this.transactionDirectory = path.resolve(transactionDirectory);
    this.backupDirectory = path.resolve(backupDirectory);
    this.dragDirectory = path.resolve(dragDirectory);
    this.mediaStore = new MediaStore({ mediaDirectory: this.mediaDirectory });
    this.lastReport = null;
  }

  countBrokenReferences(library) {
    return imageReferences(library).reduce((brokenCount, image) => {
      try {
        return this.mediaStore.verify(image.blobKey, {
          sha256: image.hash,
          size: image.size,
          mimeType: image.mimeType
        }) ? brokenCount : brokenCount + 1;
      } catch (error) {
        return brokenCount + 1;
      }
    }, 0);
  }

  countOrphanMedia(library) {
    const referencedKeys = new Set(imageReferences(library).map((image) => image.blobKey));
    return countFiles(this.mediaDirectory, (name) => name.endsWith(".media") && !referencedKeys.has(name.slice(0, -6)));
  }

  scan(library = null) {
    const mediaBytes = directoryBytes(this.mediaDirectory);
    const markdownBytes = directoryBytes(this.markdownDirectory);
    const backupBytes = directoryBytes(this.backupDirectory);
    const report = {
      generatedAt: new Date().toISOString(),
      totalBytes: markdownBytes + mediaBytes + backupBytes,
      markdownBytes,
      mediaBytes,
      backupBytes,
      mediaFiles: countFiles(this.mediaDirectory, (name) => name.endsWith(".media")),
      orphanMedia: this.countOrphanMedia(library),
      brokenReferences: this.countBrokenReferences(library),
      tempDragFiles: countFiles(this.dragDirectory, (name) => name.startsWith("clipboard-shelf-") || name.endsWith(".tmp")),
      pendingTransactions: fs.existsSync(path.join(this.transactionDirectory, "pending.json")) ? 1 : 0,
      currentGeneration: currentGeneration(this.transactionDirectory),
      backups: backupCount(this.backupDirectory),
      diagnostics: []
    };

    this.lastReport = report;
    return cloneReport(report);
  }

  repairReport() {
    return cloneReport(this.lastReport || this.scan());
  }
}

module.exports = { StorageHealth, directoryBytes };
