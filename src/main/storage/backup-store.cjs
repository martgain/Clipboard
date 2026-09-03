const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertImageBytes,
  assertPersistableLibrary,
  assertSmartCollection,
  sha256Hex
} = require("../../shared/validation.cjs");
const { MediaStore, detectMimeType } = require("./media-store.cjs");
const {
  parseCollectionMarkdown,
  parseLibraryMarkdown,
  parseLinkGroupMarkdown,
  safeCollectionFileName,
  safeCollectionFilePath,
  safeGroupFileName,
  safeGroupFilePath,
  serializeCollectionFile,
  serializeLibrarySnapshotMarkdown,
  serializeLinkGroupMarkdown
} = require("../../../markdown-library.cjs");

const BACKUP_VERSION = 1;
const BACKUP_NAME_PATTERN = /^clipboard-shelf-backup-\d{13}-[a-f0-9]{8}\.backup$/;
const PACKAGE_FILE_PATTERN = /^(?:library\.md|groups\/[^/\\]+\.md|collections\/[^/\\]+\.md|(?:media|attachments)\/[a-f0-9]{64}\.media)$/;

function hashBytes(bytes) {
  return sha256Hex(bytes);
}

function cloneLibrary(library) {
  return JSON.parse(JSON.stringify(library));
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writePackageFile(packageRoot, relativePath, contents) {
  const target = resolvePackagePath(packageRoot, relativePath);
  ensureDirectory(path.dirname(target));
  fs.writeFileSync(target, contents, { mode: 0o600 });
  return target;
}

function resolvePackagePath(packageRoot, relativePath) {
  if (typeof relativePath !== "string" || !PACKAGE_FILE_PATTERN.test(relativePath)) {
    throw new TypeError("Backup package path is invalid");
  }

  const root = path.resolve(packageRoot);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("Backup package path escapes its directory");
  }

  return target;
}

function resolveBackupDirectoryPath(backupDirectory, snapshot) {
  const candidate = path.isAbsolute(snapshot) ? snapshot : path.join(backupDirectory, snapshot);
  const root = path.resolve(backupDirectory);
  const target = path.resolve(candidate);
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative) || !BACKUP_NAME_PATTERN.test(path.basename(target))) {
    throw new TypeError("Backup snapshot path is invalid");
  }

  return target;
}

function quarantineFile(filePath) {
  const recoveryPath = `${filePath}.recovery-${Date.now()}.md`;
  try {
    fs.renameSync(filePath, recoveryPath);
  } catch (error) {
    console.warn("تعذر حفظ نسخة استرداد من ملف النسخة الاحتياطية.", error);
  }
}

function isActiveMarkdownFile(name) {
  return name.endsWith(".md") && !name.includes(".recovery-");
}

function restoreSeparateDocument({ snapshotPath, relativePath, targetDirectory, parseDocument, buildPath }) {
  const contents = fs.readFileSync(resolvePackagePath(snapshotPath, relativePath), "utf8");
  const document = parseDocument(contents);
  const target = buildPath(targetDirectory, document);
  ensureDirectory(targetDirectory);
  fs.writeFileSync(target, contents, { encoding: "utf8", mode: 0o600 });
}

function parseImageDataUrl(dataUrl) {
  const match = typeof dataUrl === "string"
    ? /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
    : null;

  if (!match) {
    throw new TypeError("Legacy image data URL is invalid");
  }

  const mimeType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  return { bytes: assertImageBytes(Buffer.from(match[2].replace(/\s/g, ""), "base64"), mimeType), mimeType };
}

function imageFingerprint(entry) {
  return entry.type === "image"
    ? `image:${entry.image.hash}:${entry.image.size}`
    : `text:${entry.text}`;
}

function assertBackupLibrary(library) {
  assertPersistableLibrary(library);

  if (!Array.isArray(library.linkGroups)) {
    throw new TypeError("Backup link groups are required");
  }

  const groupIds = new Set();
  library.linkGroups.forEach((group) => {
    const hasItems = Array.isArray(group?.items)
      && group.items.length > 0
      && group.items.every((item) => typeof item === "string" && item.trim().length > 0);
    const hasLinks = Array.isArray(group?.links)
      && group.links.length > 0
      && group.links.every((link) => {
        try {
          const url = new URL(link);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch (error) {
          return false;
        }
      });

    if (!group || typeof group !== "object"
      || typeof group.id !== "string" || group.id.trim().length === 0
      || groupIds.has(group.id)
      || typeof group.name !== "string" || group.name.trim().length === 0
      || (!hasItems && !hasLinks)) {
      throw new TypeError("Backup link group is invalid");
    }

    groupIds.add(group.id);
  });

  return library;
}

function mergeEntryLists(currentEntries, incomingEntries, normalLimit) {
  const mergedEntries = [...currentEntries];
  const fingerprints = new Set(mergedEntries.map(imageFingerprint));

  incomingEntries.forEach((entry) => {
    if (fingerprints.has(imageFingerprint(entry))) {
      return;
    }

    fingerprints.add(imageFingerprint(entry));
    mergedEntries.push(entry);
  });

  return mergedEntries.slice(0, normalLimit);
}

function mergeLibraries(currentLibrary, incomingLibrary) {
  const currentPinned = new Map(currentLibrary.pinned.map((entry) => [imageFingerprint(entry), entry]));
  const incomingPinned = incomingLibrary.pinned.filter((entry) => !currentPinned.has(imageFingerprint(entry)));
  const pinned = [...currentLibrary.pinned, ...incomingPinned];
  const pinnedFingerprints = new Set(pinned.map(imageFingerprint));
  const normal = mergeEntryLists(currentLibrary.normal, incomingLibrary.normal, 150)
    .filter((entry) => !pinnedFingerprints.has(imageFingerprint(entry)));

  return {
    ...incomingLibrary,
    settings: { ...currentLibrary.settings, ...incomingLibrary.settings, normalLimit: 150 },
    pinned,
    normal,
    smartCollections: [...currentLibrary.smartCollections, ...incomingLibrary.smartCollections]
      .filter((collection, index, collections) => collections.findIndex((candidate) => candidate.id === collection.id) === index),
    linkGroups: [...currentLibrary.linkGroups, ...incomingLibrary.linkGroups]
      .filter((group, index, groups) => groups.findIndex((candidate) => candidate.id === group.id) === index)
  };
}

function assertManifestStructure(manifest) {
  if (manifest.libraryFile !== "library.md"
    || !Array.isArray(manifest.groupFiles)
    || !Array.isArray(manifest.mediaFiles)
    || !Number.isSafeInteger(manifest.mediaCount)
    || manifest.mediaCount !== manifest.mediaFiles.length
    || !Number.isSafeInteger(manifest.itemCount)
    || manifest.itemCount < 0) {
    throw new TypeError("Backup manifest structure is invalid");
  }

  const groupFiles = manifest.groupFiles.map((filePath) => {
    if (typeof filePath !== "string" || !/^groups\/[^/\\]+\.md$/.test(filePath)) {
      throw new TypeError("Backup group file path is invalid");
    }
    return filePath;
  });
  const collectionFiles = Array.isArray(manifest.collectionFiles) ? manifest.collectionFiles.map((filePath) => {
    if (typeof filePath !== "string" || !/^collections\/[^/\\]+\.md$/.test(filePath)) {
      throw new TypeError("Backup collection file path is invalid");
    }
    return filePath;
  }) : [];
  manifest.collectionFiles = collectionFiles;
  const mediaFiles = manifest.mediaFiles.map((filePath) => {
    if (typeof filePath !== "string" || !/^(?:media|attachments)\/[a-f0-9]{64}\.media$/.test(filePath)) {
      throw new TypeError("Backup media file path is invalid");
    }
    return filePath;
  });
  const expectedPaths = ["library.md", ...groupFiles, ...collectionFiles, ...mediaFiles];

  if (new Set(expectedPaths).size !== expectedPaths.length) {
    throw new TypeError("Backup manifest contains duplicate paths");
  }

  return new Set(expectedPaths);
}

function manifestFileEntries(manifest) {
  if (!manifest || !Array.isArray(manifest.files)) {
    throw new TypeError("Backup manifest files are required");
  }

  const expectedPaths = assertManifestStructure(manifest);
  const seenPaths = new Set();
  const entries = manifest.files.map((fileEntry) => {
    if (!fileEntry || typeof fileEntry.path !== "string" || !PACKAGE_FILE_PATTERN.test(fileEntry.path)
      || seenPaths.has(fileEntry.path)
      || !/^[a-f0-9]{64}$/.test(fileEntry.sha256)
      || !Number.isSafeInteger(fileEntry.size) || fileEntry.size < 0) {
      throw new TypeError("Backup manifest file entry is invalid");
    }

    seenPaths.add(fileEntry.path);
    return fileEntry;
  });

  if (seenPaths.size !== expectedPaths.size || [...expectedPaths].some((filePath) => !seenPaths.has(filePath))) {
    throw new TypeError("Backup manifest members do not match declared files");
  }

  return entries;
}

function readChecksumEntries(checksumsText) {
  return checksumsText.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match || !PACKAGE_FILE_PATTERN.test(match[2])) {
      throw new TypeError("Backup checksum entry is invalid");
    }
    return { path: match[2], sha256: match[1] };
  });
}

function assertChecksumsMatch(fileEntries, checksumEntries) {
  if (fileEntries.length !== checksumEntries.length) {
    throw new TypeError("Backup checksum count is invalid");
  }

  const checksumsByPath = new Map(checksumEntries.map((entry) => [entry.path, entry.sha256]));
  fileEntries.forEach((fileEntry) => {
    if (checksumsByPath.get(fileEntry.path) !== fileEntry.sha256) {
      throw new TypeError("Backup checksum manifest mismatch");
    }
  });
}

function verifyPackageFiles(packageRoot, fileEntries) {
  fileEntries.forEach((fileEntry) => {
    const target = resolvePackagePath(packageRoot, fileEntry.path);
    const bytes = fs.readFileSync(target);
    if (bytes.length !== fileEntry.size || hashBytes(bytes) !== fileEntry.sha256) {
      throw new TypeError("Backup member integrity check failed");
    }
  });
}

function packageFiles(packageRoot) {
  const files = [];

  function visit(directory, relativeDirectory = "") {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      if (entry.isSymbolicLink()) {
        throw new TypeError("Backup package symlinks are not allowed");
      }

      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath.replace(/\\/g, "/"));
      } else {
        throw new TypeError("Backup package member type is invalid");
      }
    });
  }

  visit(packageRoot);
  return files;
}

function assertPackageFilesAreDeclared(packageRoot, fileEntries) {
  const allowed = new Set([
    "manifest.json",
    "checksums.sha256",
    ...fileEntries.map((fileEntry) => fileEntry.path)
  ]);
  const actualFiles = packageFiles(packageRoot);

  if (actualFiles.length !== allowed.size || actualFiles.some((filePath) => !allowed.has(filePath))) {
    throw new TypeError("Backup package contains undeclared files");
  }
}

function collectImageEntries(library) {
  const trashEntries = Array.isArray(library.trash)
    ? library.trash.map((record) => record.entry)
    : [];
  return [...library.pinned, ...library.normal, ...trashEntries].filter((entry) => entry.type === "image");
}

function assertBackupMediaReferences(packageRoot, manifest, library) {
  const mediaPaths = new Set(manifest.mediaFiles);

  collectImageEntries(library).forEach((entry) => {
    const mediaPath = [...mediaPaths].find((candidate) => candidate.endsWith(`/${entry.image.blobKey}.media`));
    if (!mediaPath) {
      throw new TypeError("Backup image reference is missing");
    }

    const bytes = fs.readFileSync(resolvePackagePath(packageRoot, mediaPath));
    assertImageBytes(bytes, entry.image.mimeType);
    if (hashBytes(bytes) !== entry.image.hash || bytes.length !== entry.image.size) {
      throw new TypeError("Backup image metadata mismatch");
    }
  });
}

function assertBackupCollectionReferences(packageRoot, manifest, library) {
  const collectionIds = new Set(library.smartCollections.map((collection) => collection.id));
  manifest.collectionFiles.forEach((relativePath) => {
    const collection = parseCollectionMarkdown(fs.readFileSync(resolvePackagePath(packageRoot, relativePath), "utf8"));
    if (!collectionIds.has(collection.id)) {
      throw new TypeError("Backup collection reference is missing");
    }
  });
}

function countLibraryItems(library) {
  return library.pinned.length + library.normal.length;
}

function restoreFile(target, previousBytes) {
  if (previousBytes === null) {
    fs.rmSync(target, { force: true });
    return;
  }

  ensureDirectory(path.dirname(target));
  fs.writeFileSync(target, previousBytes, { mode: 0o600 });
}

class BackupStore {
  constructor({ backupDirectory, markdownDirectory, mediaDirectory, legacyMediaDirectory, groupsDirectory } = {}) {
    if ([backupDirectory, markdownDirectory, mediaDirectory].some((directory) => typeof directory !== "string" || directory.trim().length === 0)) {
      throw new TypeError("Backup directories are required");
    }

    this.backupDirectory = path.resolve(backupDirectory);
    this.markdownDirectory = path.resolve(markdownDirectory);
    this.mediaDirectory = path.resolve(mediaDirectory);
    this.legacyMediaDirectory = typeof legacyMediaDirectory === "string" ? path.resolve(legacyMediaDirectory) : null;
    this.groupsDirectory = path.resolve(groupsDirectory || path.join(this.markdownDirectory, "groups"));
    this.mediaStore = new MediaStore({ mediaDirectory: this.mediaDirectory });
  }

  readLegacyMedia(mediaKey) {
    const candidates = [
      path.join(this.mediaDirectory, `${mediaKey}.dataurl`),
      this.legacyMediaDirectory ? path.join(this.legacyMediaDirectory, `${mediaKey}.dataurl`) : null
    ].filter(Boolean);

    const sourcePath = candidates.find((candidate) => fs.existsSync(candidate));
    return sourcePath ? parseImageDataUrl(fs.readFileSync(sourcePath, "utf8")) : null;
  }

  prepareLibrary(library, mediaFiles) {
    const preparedLibrary = cloneLibrary(library);

    assertBackupLibrary(preparedLibrary);
    collectImageEntries(preparedLibrary).forEach((entry) => {
      let imageBytes = null;
      const mediaKey = typeof entry.image.blobKey === "string" ? entry.image.blobKey.toLowerCase() : "";

      if (/^[a-f0-9]{64}$/.test(mediaKey) && this.mediaStore.verify(mediaKey)) {
        imageBytes = this.mediaStore.read(mediaKey);
      } else {
        const legacyMedia = this.readLegacyMedia(entry.image.blobKey);
        if (legacyMedia) {
          imageBytes = legacyMedia.bytes;
          entry.image.mimeType = legacyMedia.mimeType;
        }
      }

      if (!imageBytes) {
        throw new TypeError("Backup image bytes are missing");
      }

      const detectedMimeType = detectMimeType(imageBytes);
      if (!detectedMimeType) {
        throw new TypeError("Backup image MIME type is unsupported");
      }

      const sha256 = hashBytes(imageBytes);
      entry.image = { ...entry.image, blobKey: sha256, hash: sha256, mimeType: detectedMimeType, size: imageBytes.length };
      mediaFiles.set(sha256, imageBytes);
    });

    assertBackupLibrary(preparedLibrary);
    return preparedLibrary;
  }

  createSnapshot(library) {
    const mediaFiles = new Map();
    const preparedLibrary = this.prepareLibrary(library, mediaFiles);
    const groupFiles = preparedLibrary.linkGroups.map((group) => `groups/${safeGroupFileName(group)}`);
    const collectionRecords = Array.isArray(preparedLibrary.smartCollections) ? preparedLibrary.smartCollections : [];
    const collectionFiles = collectionRecords.map((collection) => `collections/${safeCollectionFileName(collection)}`);
    const packageName = `clipboard-shelf-backup-${String(Date.now()).padStart(13, "0")}-${crypto.randomBytes(4).toString("hex")}.backup`;
    const temporaryRoot = path.join(this.backupDirectory, `.${packageName}.tmp`);
    const snapshotPath = path.join(this.backupDirectory, packageName);
    const packageFiles = [];

    ensureDirectory(temporaryRoot);
    try {
      const libraryBytes = Buffer.from(serializeLibrarySnapshotMarkdown(preparedLibrary, {
        portable: true,
        attachmentDirectory: "attachments"
      }), "utf8");
      writePackageFile(temporaryRoot, "library.md", libraryBytes);
      packageFiles.push({ path: "library.md", sha256: hashBytes(libraryBytes), size: libraryBytes.length });

      preparedLibrary.linkGroups.forEach((group, index) => {
        const relativePath = groupFiles[index];
        const groupBytes = Buffer.from(serializeLinkGroupMarkdown(group), "utf8");
        writePackageFile(temporaryRoot, relativePath, groupBytes);
        packageFiles.push({ path: relativePath, sha256: hashBytes(groupBytes), size: groupBytes.length });
      });

      collectionRecords.forEach((collection, index) => {
        const relativePath = collectionFiles[index];
        const collectionBytes = Buffer.from(serializeCollectionFile(collection, path.join(temporaryRoot, "collections")).contents, "utf8");
        writePackageFile(temporaryRoot, relativePath, collectionBytes);
        packageFiles.push({ path: relativePath, sha256: hashBytes(collectionBytes), size: collectionBytes.length });
      });

      [...mediaFiles.entries()].sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey)).forEach(([mediaKey, mediaBytes]) => {
        const relativePath = `attachments/${mediaKey}.media`;
        writePackageFile(temporaryRoot, relativePath, mediaBytes);
        packageFiles.push({ path: relativePath, sha256: mediaKey, size: mediaBytes.length });
      });

      packageFiles.sort((left, right) => left.path.localeCompare(right.path));
      const manifest = {
        version: BACKUP_VERSION,
        type: "clipboard-shelf-backup",
        createdAt: new Date().toISOString(),
        libraryFile: "library.md",
        groupFiles,
        collectionFiles,
        mediaFiles: [...mediaFiles.keys()].sort().map((mediaKey) => `attachments/${mediaKey}.media`),
        files: packageFiles,
        itemCount: countLibraryItems(preparedLibrary),
        mediaCount: mediaFiles.size
      };
      const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
      const checksumText = `${packageFiles.map((fileEntry) => `${fileEntry.sha256}  ${fileEntry.path}`).join("\n")}\n`;
      fs.writeFileSync(path.join(temporaryRoot, "manifest.json"), manifestText, { mode: 0o600 });
      fs.writeFileSync(path.join(temporaryRoot, "checksums.sha256"), checksumText, { mode: 0o600 });
      fs.renameSync(temporaryRoot, snapshotPath);
      return { path: snapshotPath, manifestHash: hashBytes(Buffer.from(manifestText, "utf8")), itemCount: manifest.itemCount, mediaCount: manifest.mediaCount };
    } catch (error) {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
      throw error;
    }
  }

  verifySnapshot(snapshot) {
    const snapshotPath = resolveBackupDirectoryPath(this.backupDirectory, snapshot);

    try {
      const manifestPath = path.join(snapshotPath, "manifest.json");
      const manifestText = fs.readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(manifestText);
      if (manifest.version !== BACKUP_VERSION || manifest.type !== "clipboard-shelf-backup") {
        throw new TypeError("Backup format version is unsupported");
      }

      const fileEntries = manifestFileEntries(manifest);
      assertPackageFilesAreDeclared(snapshotPath, fileEntries);
      const checksumEntries = readChecksumEntries(fs.readFileSync(path.join(snapshotPath, "checksums.sha256"), "utf8"));
      assertChecksumsMatch(fileEntries, checksumEntries);
      verifyPackageFiles(snapshotPath, fileEntries);
      const library = parseLibraryMarkdown(fs.readFileSync(resolvePackagePath(snapshotPath, manifest.libraryFile), "utf8"));
      assertBackupLibrary(library);
      if (manifest.itemCount !== countLibraryItems(library) || manifest.groupFiles.length !== library.linkGroups.length) {
        throw new TypeError("Backup manifest counts do not match library");
      }
      if (manifest.collectionFiles.length !== library.smartCollections.length) {
        throw new TypeError("Backup collection counts do not match library");
      }
      assertBackupMediaReferences(snapshotPath, manifest, library);
      assertBackupCollectionReferences(snapshotPath, manifest, library);
      return { valid: true, manifest, library, mediaCount: manifest.mediaCount, diagnostics: [] };
    } catch (error) {
      return { valid: false, diagnostics: [{ code: "BACKUP_INVALID", severity: "error", message: "Backup verification failed." }] };
    }
  }

  readCurrentLibrary() {
    const libraryPath = path.join(this.markdownDirectory, "library.md");
    if (!fs.existsSync(libraryPath)) {
      return null;
    }

    const library = parseLibraryMarkdown(fs.readFileSync(libraryPath, "utf8"));
    const groupFiles = fs.existsSync(this.groupsDirectory)
      ? fs.readdirSync(this.groupsDirectory).filter(isActiveMarkdownFile).sort()
      : [];
    groupFiles.forEach((name) => {
      const target = path.join(this.groupsDirectory, name);
      try {
        const group = parseLinkGroupMarkdown(fs.readFileSync(target, "utf8"));
        if (!library.linkGroups.some((candidate) => candidate.id === group.id)) {
          library.linkGroups.push(group);
        }
      } catch (error) {
        quarantineFile(target);
      }
    });
    const collectionsDirectory = path.join(this.markdownDirectory, "collections");
    const collectionFiles = fs.existsSync(collectionsDirectory)
      ? fs.readdirSync(collectionsDirectory).filter(isActiveMarkdownFile).sort()
      : [];
    collectionFiles.forEach((name) => {
      const target = path.join(collectionsDirectory, name);
      try {
        const collection = parseCollectionMarkdown(fs.readFileSync(target, "utf8"));
        assertSmartCollection(collection);
        if (!library.smartCollections.some((candidate) => candidate.id === collection.id)) {
          library.smartCollections.push(collection);
        }
      } catch (error) {
        quarantineFile(target);
      }
    });
    assertBackupLibrary(library);
    return library;
  }

  restore(snapshot, mode = "replace") {
    if (mode !== "replace" && mode !== "merge") {
      throw new TypeError("Backup restore mode is invalid");
    }

    const verification = this.verifySnapshot(snapshot);
    if (!verification.valid) {
      throw new TypeError("Backup verification failed before restore: checksum or integrity error");
    }

    const snapshotPath = resolveBackupDirectoryPath(this.backupDirectory, snapshot);
    const manifest = verification.manifest;
    const incomingLibrary = verification.library;
    const currentLibrary = mode === "merge" ? this.readCurrentLibrary() : null;
    const restoredLibrary = currentLibrary ? mergeLibraries(currentLibrary, incomingLibrary) : incomingLibrary;
    assertBackupLibrary(restoredLibrary);
    const previousLibraryPath = path.join(this.markdownDirectory, "library.md");
    const previousLibraryBytes = fs.existsSync(previousLibraryPath) ? fs.readFileSync(previousLibraryPath) : null;

    try {
      manifest.mediaFiles.forEach((relativeMediaPath) => {
        const mediaBytes = fs.readFileSync(resolvePackagePath(snapshotPath, relativeMediaPath));
        const stored = this.mediaStore.write(mediaBytes, detectMimeType(mediaBytes));
        if (stored.mediaKey !== path.basename(relativeMediaPath, ".media")) {
          throw new TypeError("Restored media key mismatch");
        }
      });

      manifest.groupFiles.forEach((relativePath) => restoreSeparateDocument({
        snapshotPath,
        relativePath,
        targetDirectory: this.groupsDirectory,
        parseDocument: parseLinkGroupMarkdown,
        buildPath: safeGroupFilePath
      }));
      manifest.collectionFiles.forEach((relativePath) => restoreSeparateDocument({
        snapshotPath,
        relativePath,
        targetDirectory: path.join(this.markdownDirectory, "collections"),
        parseDocument: parseCollectionMarkdown,
        buildPath: safeCollectionFilePath
      }));

      ensureDirectory(this.markdownDirectory);
      fs.writeFileSync(previousLibraryPath, serializeLibrarySnapshotMarkdown(restoredLibrary), { encoding: "utf8", mode: 0o600 });
      return {
        generation: `restore-${Date.now()}`,
        restoredItems: countLibraryItems(restoredLibrary),
        library: restoredLibrary,
        diagnostics: []
      };
    } catch (error) {
      restoreFile(previousLibraryPath, previousLibraryBytes);
      throw error;
    }
  }

  list() {
    if (!fs.existsSync(this.backupDirectory)) {
      return [];
    }

    return fs.readdirSync(this.backupDirectory)
      .filter((name) => BACKUP_NAME_PATTERN.test(name))
      .sort()
      .reverse();
  }
}

module.exports = { BACKUP_NAME_PATTERN, BACKUP_VERSION, BackupStore };
