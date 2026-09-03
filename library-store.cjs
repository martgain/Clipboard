const fs = require("node:fs");
const path = require("node:path");
const { BACKUP_NAME_PATTERN, createBackupPlan } = require("./backup-policy.cjs");
const { normalizeGroupIcon } = require("./link-group-icons.js");
const {
  assertImageBytes,
  assertPersistableLibrary: assertValidatedLibrary,
  assertSmartCollection
} = require("./src/shared/validation.cjs");
const { TransactionStore } = require("./src/main/storage/transaction-store.cjs");
const { VersionHistory } = require("./version-history.cjs");
const { MediaStore } = require("./src/main/storage/media-store.cjs");
const { writeAtomicTextFile } = require("./src/main/storage/replace-safe.cjs");
const {
  parseLibraryMarkdown,
  parseCollectionMarkdown,
  parseLinkGroupMarkdown,
  serializeCollectionFile,
  safeGroupFilePath,
  serializeLibraryMarkdown,
  serializeLibrarySnapshotMarkdown,
  serializeLinkGroupMarkdown
} = require("./markdown-library.cjs");

const LIBRARY_SCHEMA_VERSION = 2;
const DEFAULT_BATCH_SEPARATOR = "<<<CLIPBOARD-ITEM>>>";
const DEFAULT_BACKUP_RETENTION = 5;
const DEFAULT_BACKUP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const DEFAULT_MEDIA_GRACE_MS = 24 * 60 * 60 * 1000;

function createDefaultLibrary() {
  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    settings: {
      theme: "light",
      duplicatePolicy: "dedupe-move-to-top",
      normalLimit: 150,
      autoCapture: true,
      batchSeparator: DEFAULT_BATCH_SEPARATOR,
      globalShortcutEnabled: false,
      searchQuery: "",
      privacyMode: false,
      retentionDays: 0
    },
    pinned: [],
    normal: [],
    smartCollections: [],
    trash: [],
    linkGroups: []
  };
}

function cloneValue(inputValue) {
  return JSON.parse(JSON.stringify(inputValue));
}

function isValidTags(tags) {
  return tags === undefined
    || (Array.isArray(tags)
      && tags.length <= 20
      && tags.every((tag) => typeof tag === "string" && tag.trim().length > 0 && tag.trim().length <= 30));
}

function migrateLibrary(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  if (raw.schemaVersion === LIBRARY_SCHEMA_VERSION) {
    return raw;
  }

  if (raw.schemaVersion === 1
    && raw.settings
    && typeof raw.settings === "object"
    && Array.isArray(raw.pinned)
    && Array.isArray(raw.normal)) {
    return {
      ...raw,
      schemaVersion: LIBRARY_SCHEMA_VERSION,
      smartCollections: Array.isArray(raw.smartCollections) ? raw.smartCollections : [],
      trash: Array.isArray(raw.trash) ? raw.trash : [],
      linkGroups: Array.isArray(raw.linkGroups) ? raw.linkGroups : [],
      settings: {
        ...raw.settings,
        batchSeparator: raw.settings.batchSeparator || DEFAULT_BATCH_SEPARATOR,
        searchQuery: typeof raw.settings.searchQuery === "string" ? raw.settings.searchQuery : "",
        privacyMode: raw.settings.privacyMode === true,
        retentionDays: Number.isInteger(raw.settings.retentionDays) ? raw.settings.retentionDays : 0
      }
    };
  }

  return null;
}

function normalizeStoredGroup(group) {
  if (!group || typeof group !== "object") {
    return null;
  }

  return {
    ...group,
    icon: normalizeGroupIcon(group.icon)
  };
}

function appendUniqueRecords(primaryRecords, additionalRecords) {
  const seenIds = new Set(primaryRecords.map((record) => record.id));
  const merged = [...primaryRecords];
  additionalRecords.forEach((record) => {
    if (seenIds.has(record.id)) {
      return;
    }

    seenIds.add(record.id);
    merged.push(record);
  });
  return merged;
}

function isActiveMarkdownFile(name) {
  return name.endsWith(".md") && !name.includes(".recovery-");
}

function normalizeLibrary(raw) {
  const defaults = createDefaultLibrary();
  const migrated = migrateLibrary(raw);

  if (!migrated) {
    return defaults;
  }

  return {
    schemaVersion: LIBRARY_SCHEMA_VERSION,
    settings: {
      ...defaults.settings,
      ...(migrated.settings && typeof migrated.settings === "object" ? migrated.settings : {}),
      normalLimit: 150
    },
    pinned: Array.isArray(migrated.pinned) ? migrated.pinned : [],
    normal: Array.isArray(migrated.normal) ? migrated.normal : [],
    smartCollections: Array.isArray(migrated.smartCollections) ? migrated.smartCollections : [],
    trash: Array.isArray(migrated.trash) ? migrated.trash : [],
    linkGroups: Array.isArray(migrated.linkGroups)
      ? migrated.linkGroups.map((group) => normalizeStoredGroup(group)).filter(Boolean)
      : []
  };
}

function isHttpLink(candidate) {
  if (typeof candidate !== "string") {
    return false;
  }

  try {
    const parsed = new URL(candidate.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (urlError) {
    return false;
  }
}

function isValidStoredEntry(entry) {
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !entry.id) {
    return false;
  }

  if (entry.type === "text") {
    return typeof entry.text === "string" && entry.text.trim().length > 0 && isValidTags(entry.tags);
  }

  return entry.type === "image"
    && entry.image
    && typeof entry.image === "object"
    && typeof entry.image.blobKey === "string"
    && /^[a-zA-Z0-9._-]+$/.test(entry.image.blobKey)
    && typeof entry.image.mimeType === "string"
    && entry.image.mimeType.startsWith("image/")
    && typeof entry.image.size === "number"
    && entry.image.size >= 0
    && typeof entry.image.hash === "string"
    && entry.image.hash.length > 0
    && isValidTags(entry.tags);
}

function isValidStoredGroup(group) {
  const hasItems = Array.isArray(group?.items)
    && group.items.length > 0
    && group.items.every((item) => typeof item === "string" && item.trim().length > 0);
  const hasLegacyLinks = Array.isArray(group?.links)
    && group.links.length > 0
    && group.links.every(isHttpLink);

  return Boolean(
    group
    && typeof group === "object"
    && typeof group.id === "string"
    && group.id
    && typeof group.name === "string"
    && group.name.trim().length > 0
    && (hasItems || hasLegacyLinks)
  );
}

function assertPersistableLibrary(library) {
  assertValidatedLibrary(library);

  if (!library || typeof library !== "object" || library.schemaVersion !== LIBRARY_SCHEMA_VERSION) {
    throw new TypeError("Unsupported library schema");
  }

  const settings = library.settings;
  const validSettings = settings
    && (settings.theme === "light" || settings.theme === "dark")
    && settings.normalLimit === 150
    && typeof settings.autoCapture === "boolean"
    && typeof settings.batchSeparator === "string"
    && settings.batchSeparator.length >= 3
    && settings.batchSeparator.length <= 80
    && !/[\r\n]/.test(settings.batchSeparator)
    && (settings.globalShortcutEnabled === undefined || typeof settings.globalShortcutEnabled === "boolean")
    && (settings.searchQuery === undefined || typeof settings.searchQuery === "string")
    && (settings.privacyMode === undefined || typeof settings.privacyMode === "boolean")
    && (settings.retentionDays === undefined || (Number.isInteger(settings.retentionDays) && settings.retentionDays >= 0 && settings.retentionDays <= 3650));

  if (!validSettings
    || !Array.isArray(library.pinned)
    || !Array.isArray(library.normal)
    || !Array.isArray(library.smartCollections)
    || !Array.isArray(library.trash)
    || !Array.isArray(library.linkGroups)) {
    throw new TypeError("Malformed library payload");
  }

  if (![...library.pinned, ...library.normal].some((entry) => !isValidStoredEntry(entry)) && !library.linkGroups.some((group) => !isValidStoredGroup(group))) {
    return;
  }

  throw new TypeError("Malformed library payload");
}

function assertSafeMediaKey(mediaKey) {
  if (typeof mediaKey !== "string" || !/^[a-zA-Z0-9._-]+$/.test(mediaKey)) {
    throw new TypeError("Invalid media key");
  }
}

function assertImageDataUrl(dataUrl, maxImageBytes = DEFAULT_MAX_IMAGE_BYTES) {
  const match = typeof dataUrl === "string"
    ? /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
    : null;

  if (!match) {
    throw new TypeError("Invalid image data URL");
  }

  const bytes = assertImageBytes(Buffer.from(match[2].replace(/\s/g, ""), "base64"), match[1], maxImageBytes);
  return { bytes, mimeType: match[1].toLowerCase() };
}

function createLibraryStore({
  dataFile,
  legacyDataFile,
  markdownDirectory,
  mediaDirectory,
  backupDirectory,
  backupRetention = DEFAULT_BACKUP_RETENTION,
  backupIntervalMs = DEFAULT_BACKUP_INTERVAL_MS,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  legacyMediaDirectory
}) {
  if (typeof dataFile !== "string" || typeof mediaDirectory !== "string") {
    throw new TypeError("Library store paths are required");
  }

  const legacyDataFiles = [...new Set([dataFile, legacyDataFile].filter((filePath) => typeof filePath === "string"))];
  const resolvedMarkdownDirectory = markdownDirectory || path.join(path.dirname(dataFile), "markdown");
  const markdownFile = path.join(resolvedMarkdownDirectory, "library.md");
  const groupsDirectory = path.join(resolvedMarkdownDirectory, "groups");
  const collectionsDirectory = path.join(resolvedMarkdownDirectory, "collections");
  const journalFile = `${markdownFile}.pending`;
  const legacyJournalFiles = legacyDataFiles.map((filePath) => `${filePath}.pending`);
  const resolvedBackupDirectory = backupDirectory || path.join(path.dirname(dataFile), "backups");
  const mediaStore = new MediaStore({ mediaDirectory, maxBytes: maxImageBytes });
  const transactionStore = new TransactionStore({
    rootDirectory: path.join(resolvedMarkdownDirectory, ".transactions"),
    serializeState: serializeLibrarySnapshotMarkdown,
    deserializeState: (contents) => normalizeLibrary(parseLibraryMarkdown(contents)),
    validateState: assertPersistableLibrary
  });
  const versionHistory = new VersionHistory({ transactionStore });
  let lastBackupAt = 0;

  function mediaFilePath(mediaKey) {
    assertSafeMediaKey(mediaKey);
    const root = path.resolve(mediaDirectory);
    const target = path.resolve(root, `${mediaKey}.dataurl`);
    const relative = path.relative(root, target);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new TypeError("Media key escapes media directory");
    }

    return target;
  }

  function legacyMediaFilePath(mediaKey) {
    if (!legacyMediaDirectory) {
      return null;
    }

    const root = path.resolve(legacyMediaDirectory);
    const target = path.resolve(root, `${mediaKey}.dataurl`);
    const relative = path.relative(root, target);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }

    return target;
  }

  function trashEntries(library) {
    return Array.isArray(library?.trash)
      ? library.trash
        .map((record) => record?.entry)
        .filter((entry) => entry && typeof entry === "object")
      : [];
  }

  function imageEntries(library) {
    return library && Array.isArray(library.pinned) && Array.isArray(library.normal)
      ? [...library.pinned, ...library.normal, ...trashEntries(library)]
        .filter((entry) => entry && entry.type === "image" && entry.image && typeof entry.image.blobKey === "string")
      : [];
  }

  function legacyImageDataUrl(mediaKey) {
    const currentTarget = mediaFilePath(mediaKey);

    if (fs.existsSync(currentTarget)) {
      return fs.readFileSync(currentTarget, "utf8");
    }

    const legacyTarget = legacyMediaFilePath(mediaKey);
    return legacyTarget && fs.existsSync(legacyTarget)
      ? fs.readFileSync(legacyTarget, "utf8")
      : null;
  }

  function applyStoredImageMetadata(image, stored) {
    const changed = image.blobKey !== stored.mediaKey
      || image.mimeType !== stored.mimeType
      || image.size !== stored.size
      || image.hash !== stored.sha256;
    image.blobKey = stored.mediaKey;
    image.mimeType = stored.mimeType;
    image.size = stored.size;
    image.hash = stored.sha256;
    return changed;
  }

  function hasValidContentAddressedMedia(image) {
    if (!/^[a-f0-9]{64}$/i.test(image.blobKey)) {
      return false;
    }

    try {
      const mediaKey = image.blobKey.toLowerCase();
      return mediaStore.verify(mediaKey, {
        sha256: mediaKey,
        mimeType: image.mimeType,
        size: image.size
      });
    } catch (error) {
      return false;
    }
  }

  function migrateImageEntry(entry) {
    const image = entry.image;

    if (hasValidContentAddressedMedia(image)) {
      return image.hash !== image.blobKey.toLowerCase() && applyStoredImageMetadata(image, {
        mediaKey: image.blobKey.toLowerCase(),
        mimeType: image.mimeType,
        size: image.size,
        sha256: image.blobKey.toLowerCase()
      });
    }

    const dataUrl = legacyImageDataUrl(image.blobKey);
    if (!dataUrl) {
      return false;
    }

    try {
      const parsed = assertImageDataUrl(dataUrl, maxImageBytes);
      return applyStoredImageMetadata(image, mediaStore.write(parsed.bytes, parsed.mimeType));
    } catch (error) {
      console.warn("تعذر ترحيل ملف صورة قديم إلى التخزين الموثق.", error);
      return false;
    }
  }

  function migrateLegacyMedia(library) {
    let migratedCount = 0;

    imageEntries(library).forEach((entry) => {
      if (migrateImageEntry(entry)) {
        migratedCount += 1;
      }
    });

    return migratedCount;
  }

  function readLegacyLibrary(filePath) {
    const storedLibrary = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const migrated = migrateLibrary(storedLibrary);

    if (!migrated) {
      throw new TypeError("Unsupported library schema");
    }

    const normalized = normalizeLibrary(migrated);
    assertPersistableLibrary(normalized);
    return normalized;
  }

  function readGroupFiles() {
    if (!fs.existsSync(groupsDirectory)) {
      return [];
    }

    return fs.readdirSync(groupsDirectory)
      .filter(isActiveMarkdownFile)
      .sort()
      .map((name) => {
        const root = path.resolve(groupsDirectory);
        const target = path.resolve(root, name);
        const relative = path.relative(root, target);

        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new TypeError("Group file escapes groups directory");
        }

        try {
          return normalizeStoredGroup(parseLinkGroupMarkdown(fs.readFileSync(target, "utf8")));
        } catch (error) {
          renameForRecovery(target, ".md");
          return null;
        }
      })
      .filter(Boolean);
  }

  function readCollectionFiles() {
    if (!fs.existsSync(collectionsDirectory)) {
      return [];
    }

    return fs.readdirSync(collectionsDirectory)
      .filter(isActiveMarkdownFile)
      .sort()
      .map((name) => {
        const target = path.resolve(collectionsDirectory, name);
        const relative = path.relative(path.resolve(collectionsDirectory), target);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          throw new TypeError("Collection file escapes collections directory");
        }

        try {
          const collection = parseCollectionMarkdown(fs.readFileSync(target, "utf8"));
          assertSmartCollection(collection);
          return collection;
        } catch (error) {
          renameForRecovery(target, ".md");
          return null;
        }
      })
      .filter(Boolean);
  }

  function readMarkdownFile(filePath) {
    const markdown = fs.readFileSync(filePath, "utf8");
    const parsed = parseLibraryMarkdown(markdown);
    const normalized = normalizeLibrary(parsed);
    assertPersistableLibrary(normalized);
    return normalized;
  }

  function readCurrentMarkdown() {
    const library = readMarkdownFile(markdownFile);

    library.linkGroups = appendUniqueRecords(library.linkGroups, readGroupFiles());
    library.smartCollections = appendUniqueRecords(library.smartCollections, readCollectionFiles());
    assertPersistableLibrary(library);

    return library;
  }

  function mirrorLoadedLibraryToTransaction(library) {
    try {
      transactionStore.commitSync(library);
    } catch (error) {
      console.warn("تعذر إنشاء generation آمنة من مكتبة Markdown الحالية.", error);
    }

    return cloneValue(library);
  }

  function loadTransaction() {
    if (!fs.existsSync(transactionStore.currentPath)) {
      return null;
    }

    try {
      const loaded = transactionStore.loadSync();
      const migratedCount = migrateLegacyMedia(loaded.state);
      return migratedCount > 0 ? save(loaded.state) : cloneValue(loaded.state);
    } catch (error) {
      console.warn("تعذر قراءة generation آمنة من مكتبة الحافظة.", error);
      return null;
    }
  }

  function writeAtomic(target, contents) {
    writeAtomicTextFile(target, contents);
  }

  function renameForRecovery(filePath, extension) {
    const recoveryPath = `${filePath}.recovery-${Date.now()}${extension}`;

    try {
      fs.renameSync(filePath, recoveryPath);
    } catch (recoveryError) {
      console.warn("تعذر حفظ نسخة استرداد من ملف المكتبة.", recoveryError);
    }
  }

  function backupName(timestamp = new Date()) {
    const datePart = timestamp.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const milliseconds = String(timestamp.getMilliseconds()).padStart(3, "0");
    return `library-${datePart}-${milliseconds}.md`;
  }

  function rotateBackups() {
    const backupNames = createBackupPlan(fs.readdirSync(resolvedBackupDirectory), backupRetention);
    const retainedNames = new Set(backupNames);

    fs.readdirSync(resolvedBackupDirectory).forEach((name) => {
      if (BACKUP_NAME_PATTERN.test(name) && !retainedNames.has(name)) {
        fs.rmSync(path.join(resolvedBackupDirectory, name), { force: true });
      }
    });
  }

  function createBackupIfDue() {
    if (!fs.existsSync(markdownFile) || !Number.isInteger(backupRetention) || backupRetention < 1) {
      return;
    }

    const now = Date.now();

    if (backupIntervalMs > 0 && now - lastBackupAt < backupIntervalMs) {
      return;
    }

    let currentLibrary;

    try {
      currentLibrary = readCurrentMarkdown();
    } catch (error) {
      console.warn("تعذر إنشاء نسخة احتياطية من ملف Markdown الحالي.", error);
      return;
    }

    fs.mkdirSync(resolvedBackupDirectory, { recursive: true });
    writeAtomic(
      path.join(resolvedBackupDirectory, backupName(new Date(now))),
      serializeLibrarySnapshotMarkdown(currentLibrary)
    );
    lastBackupAt = now;
    rotateBackups();
  }

  function writeGroupFiles(library) {
    library.linkGroups.forEach((group) => {
      const target = safeGroupFilePath(groupsDirectory, group);
      writeAtomic(target, serializeLinkGroupMarkdown(group));
    });
  }

  function writeCollectionFiles(library) {
    library.smartCollections.forEach((collection) => {
      const serialized = serializeCollectionFile(collection, collectionsDirectory);
      writeAtomic(serialized.path, serialized.contents);
    });
  }

  function save(library) {
    const normalized = normalizeLibrary(library);
    assertPersistableLibrary(normalized);
    createBackupIfDue();

    transactionStore.commitSync(normalized);
    fs.mkdirSync(resolvedMarkdownDirectory, { recursive: true });
    fs.mkdirSync(groupsDirectory, { recursive: true });
    fs.mkdirSync(collectionsDirectory, { recursive: true });
    writeAtomic(journalFile, serializeLibrarySnapshotMarkdown(normalized));

    writeAtomic(markdownFile, serializeLibraryMarkdown(normalized));
    writeGroupFiles(normalized);
    writeCollectionFiles(normalized);
    fs.rmSync(journalFile, { force: true });

    return cloneValue(normalized);
  }

  function recoverPendingMarkdown() {
    if (fs.existsSync(journalFile)) {
      try {
        const pendingLibrary = readMarkdownFile(journalFile);
        migrateLegacyMedia(pendingLibrary);
        return save(pendingLibrary);
      } catch (error) {
        renameForRecovery(journalFile, ".md");
      }
    }

    return null;
  }

  function loadCurrentMarkdown() {
    if (fs.existsSync(markdownFile)) {
      try {
        const loadedLibrary = readCurrentMarkdown();
        const migratedCount = migrateLegacyMedia(loadedLibrary);
        return migratedCount > 0 ? save(loadedLibrary) : mirrorLoadedLibraryToTransaction(loadedLibrary);
      } catch (error) {
        renameForRecovery(markdownFile, ".md");
      }
    }

    return null;
  }

  function loadLegacyJson() {
    const legacySource = legacyDataFiles.find((filePath) => fs.existsSync(filePath));

    if (legacySource) {
      try {
        const loadedLibrary = readLegacyLibrary(legacySource);
        migrateLegacyMedia(loadedLibrary);
        return save(loadedLibrary);
      } catch (error) {
        renameForRecovery(legacySource, ".json");
      }
    }

    return null;
  }

  function loadLegacyJournal() {
    const legacyJournal = legacyJournalFiles.find((filePath) => fs.existsSync(filePath));

    if (legacyJournal) {
      try {
        const loadedLibrary = readLegacyLibrary(legacyJournal);
        migrateLegacyMedia(loadedLibrary);
        return save(loadedLibrary);
      } catch (error) {
        renameForRecovery(legacyJournal, ".json");
      }
    }

    return null;
  }

  function load() {
    return recoverPendingMarkdown()
      || loadTransaction()
      || loadCurrentMarkdown()
      || loadLegacyJson()
      || loadLegacyJournal()
      || createDefaultLibrary();
  }

  function hasReadableLegacyFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      readLegacyLibrary(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  function hasData() {
    if (fs.existsSync(transactionStore.currentPath)) {
      try {
        transactionStore.loadSync();
        return true;
      } catch (error) {
        // Continue to the legacy Markdown/JSON checks below.
      }
    }

    if (fs.existsSync(journalFile)) {
      try {
        readMarkdownFile(journalFile);
        return true;
      } catch (error) {
        return false;
      }
    }

    if (fs.existsSync(markdownFile)) {
      try {
        readCurrentMarkdown();
        return true;
      } catch (error) {
        return false;
      }
    }

    return legacyDataFiles.some(hasReadableLegacyFile);
  }

  function readBackup(name) {
    const target = path.join(resolvedBackupDirectory, name);
    return name.endsWith(".json")
      ? readLegacyLibrary(target)
      : readMarkdownFile(target);
  }

  function listBackups() {
    if (!fs.existsSync(resolvedBackupDirectory)) {
      return [];
    }

    return createBackupPlan(fs.readdirSync(resolvedBackupDirectory), backupRetention);
  }

  function restoreBackup(name) {
    if (typeof name !== "string" || !BACKUP_NAME_PATTERN.test(name)) {
      throw new TypeError("Invalid backup name");
    }

    const root = path.resolve(resolvedBackupDirectory);
    const target = path.resolve(root, name);
    const relative = path.relative(root, target);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new TypeError("Backup name escapes backup directory");
    }

    return save(readBackup(name));
  }

  function listVersionHistory() {
    return versionHistory.list();
  }

  function inspectVersionHistory(generation) {
    return versionHistory.inspect(generation);
  }

  function restoreVersionHistory(generation) {
    const snapshot = versionHistory.inspect(generation);
    const restored = save(snapshot.state);
    return { ...restored, sourceGeneration: snapshot.id };
  }

  function writeImage(mediaKey, dataUrl) {
    const compatibilityTarget = mediaFilePath(mediaKey);
    const parsed = assertImageDataUrl(dataUrl, maxImageBytes);
    const stored = mediaStore.write(parsed.bytes, parsed.mimeType);

    if (mediaKey !== stored.mediaKey) {
      writeAtomic(compatibilityTarget, dataUrl);
    }

    return stored;
  }

  function readImage(mediaKey) {
    const contentAddressedDataUrl = /^[a-f0-9]{64}$/i.test(mediaKey)
      ? mediaStore.readDataUrl(mediaKey.toLowerCase())
      : null;

    if (contentAddressedDataUrl) {
      return contentAddressedDataUrl;
    }

    const target = mediaFilePath(mediaKey);

    if (fs.existsSync(target)) {
      return fs.readFileSync(target, "utf8");
    }

    const legacyTarget = legacyMediaFilePath(mediaKey);
    return legacyTarget && fs.existsSync(legacyTarget)
      ? fs.readFileSync(legacyTarget, "utf8")
      : null;
  }

  function deleteImage(mediaKey) {
    if (!/^[a-f0-9]{64}$/i.test(mediaKey)) {
      fs.rmSync(mediaFilePath(mediaKey), { force: true });
    }
  }

  function referencedMediaKeys(library) {
    return new Set([...library.pinned, ...library.normal, ...trashEntries(library)]
      .filter((entry) => entry && entry.type === "image" && entry.image && typeof entry.image.blobKey === "string")
      .map((entry) => entry.image.blobKey));
  }

  function removeLegacyMediaAliases(referencedKeys) {
    let removedCount = 0;

    fs.readdirSync(mediaDirectory).forEach((name) => {
      if (!name.endsWith(".dataurl")) {
        return;
      }

      const mediaKey = name.slice(0, -8);
      if (referencedKeys.has(mediaKey)) {
        return;
      }

      fs.rmSync(path.join(mediaDirectory, name), { force: true });
      removedCount += 1;
    });

    return removedCount;
  }

  function cleanupMedia(library) {
    if (!library || !Array.isArray(library.pinned) || !Array.isArray(library.normal)) {
      throw new TypeError("Library entries are required");
    }

    if (!fs.existsSync(mediaDirectory)) {
      return 0;
    }

    const referencedKeys = referencedMediaKeys(library);
    const removedAliases = removeLegacyMediaAliases(referencedKeys);
    const reconciled = mediaStore.reconcile(referencedKeys, { graceMs: DEFAULT_MEDIA_GRACE_MS });
    return removedAliases + reconciled.removed.length;
  }

  return Object.freeze({
    load,
    hasData,
    save,
    writeImage,
    readImage,
    deleteImage,
    listBackups,
    restoreBackup,
    listVersionHistory,
    inspectVersionHistory,
    restoreVersionHistory,
    cleanupMedia,
    migrateLegacyMedia
  });
}

module.exports = {
  DEFAULT_BATCH_SEPARATOR,
  DEFAULT_MAX_IMAGE_BYTES,
  LIBRARY_SCHEMA_VERSION,
  createDefaultLibrary,
  createLibraryStore,
  normalizeLibrary
};
