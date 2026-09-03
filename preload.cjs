const { contextBridge, ipcRenderer } = require("electron");
const CHANNELS = Object.freeze({
  libraryRestoreBackup: "library:restore-backup",
  libraryVerifySnapshot: "library:verify-snapshot",
  libraryRestoreSnapshot: "library:restore-snapshot",
  libraryListVersionHistory: "library:list-version-history",
  libraryRestoreVersionHistory: "library:restore-version-history",
  libraryWriteImage: "library:write-image",
  libraryReadImage: "library:read-image",
  libraryDeleteImage: "library:delete-image",
  dragImage: "drag:image",
  clipboardWriteImage: "clipboard:write-image",
  clipboardWriteSequence: "clipboard:write-sequence",
  clipboardTransformText: "clipboard:transform-text",
  imageAnalyze: "image:analyze",
  ocrIndexRebuild: "ocr:index-rebuild",
  libraryAppHealth: "library:app-health",
  libraryConflict: "library:conflict",
  quickPaletteRequested: "quick-palette:request"
});
const MEDIA_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const GENERATION_PATTERN = /^gen-\d{13}-[a-f0-9]{12}$/;
// Keep this boundary validator self-contained because the sandboxed preload cannot import renderer/shared modules.
const SHORTCUT_MODIFIERS = Object.freeze({ ctrl: "Ctrl", control: "Ctrl", commandorcontrol: "CommandOrControl", command: "Command", cmd: "Command", alt: "Alt", option: "Alt", shift: "Shift", super: "Super" });
const SHORTCUT_KEYS = Object.freeze({ space: "Space", tab: "Tab", enter: "Enter", escape: "Escape", esc: "Escape", backspace: "Backspace", delete: "Delete", insert: "Insert", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown", up: "Up", down: "Down", left: "Left", right: "Right" });
const SUPPORTED_TRANSFORM_OPERATIONS = new Set([
  "whitespace-cleanup", "uppercase", "lowercase", "quotes-straighten",
  "quotes-smart", "bullets-to-numbered", "numbered-to-bullets"
]);

function normalizeGlobalShortcut(candidate) {
  if (typeof candidate !== "string" || candidate.length > 80 || /[\r\n]/.test(candidate)) return "";
  const parts = candidate.trim().split("+");
  if (parts.length < 2 || parts.some((part) => !part.trim())) return "";
  const modifiers = [];
  let key = "";
  for (const rawPart of parts) {
    const part = rawPart.trim();
    const lowered = part.toLocaleLowerCase();
    const modifier = SHORTCUT_MODIFIERS[lowered];
    if (modifier) {
      if (modifiers.includes(modifier)) return "";
      modifiers.push(modifier);
      continue;
    }
    if (key) return "";
    key = SHORTCUT_KEYS[lowered] || (/^[a-z]$/i.test(part) ? part.toLocaleUpperCase() : (/^[0-9]$/.test(part) ? part : (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(part) ? part.toLocaleUpperCase() : "")));
    if (!key) return "";
  }
  if (modifiers.length === 0 || !key) return "";
  const rank = { Ctrl: 0, CommandOrControl: 0, Command: 0, Alt: 1, Shift: 2, Super: 3 };
  modifiers.sort((left, right) => rank[left] - rank[right]);
  return [...modifiers, key].join("+");
}

function validatePasteSequencePayload(entries, options) {
  if (!Array.isArray(entries) || entries.length > 150) {
    throw new TypeError("Paste sequence entries are invalid");
  }

  entries.forEach((entry) => {
    const validEntry = typeof entry === "string"
      || (entry && typeof entry === "object" && !Array.isArray(entry)
        && typeof entry.text === "string" && entry.text.length <= 100000
        && (entry.id === undefined || (typeof entry.id === "string" && entry.id.length > 0)));
    if (!validEntry) {
      throw new TypeError("Paste sequence entry is invalid");
    }
  });

  if (options === undefined) {
    return;
  }
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Paste sequence options are invalid");
  }
  if (options.separator !== undefined
    && (typeof options.separator !== "string" || options.separator.length === 0 || options.separator.length > 80)) {
    throw new TypeError("Paste sequence separator is invalid");
  }
  if (options.order !== undefined
    && (!Array.isArray(options.order) || options.order.length > 150
      || options.order.some((selector) => !Number.isInteger(selector) && (typeof selector !== "string" || !selector)))) {
    throw new TypeError("Paste sequence order is invalid");
  }
}

function validatePayload(channel, args = []) {
  if (!Object.values(CHANNELS).includes(channel)) {
    throw new TypeError("Unknown IPC channel");
  }

  if ([
    CHANNELS.libraryReadImage,
    CHANNELS.libraryDeleteImage,
    CHANNELS.libraryWriteImage,
    CHANNELS.dragImage
  ].includes(channel) && (
    typeof args[0] !== "string" ||
    !MEDIA_KEY_PATTERN.test(args[0]) ||
    args[0].includes("..")
  )) {
    throw new TypeError("media path is invalid");
  }

  if (channel === CHANNELS.libraryRestoreBackup && (
    typeof args[0] !== "string" ||
    !MEDIA_KEY_PATTERN.test(args[0]) ||
    args[0].includes("..")
  )) {
    throw new TypeError("backup path is invalid");
  }

  if (channel === CHANNELS.libraryRestoreVersionHistory && (
    typeof args[0] !== "string" || !GENERATION_PATTERN.test(args[0])
  )) {
    throw new TypeError("generation id is invalid");
  }

  if (channel === CHANNELS.libraryWriteImage && (
    typeof args[1] !== "string" ||
    !/^data:image\/[a-z0-9.+-]+;base64,/i.test(args[1])
  )) {
    throw new TypeError("Library image data URL is invalid");
  }

  if (channel === CHANNELS.clipboardWriteImage && (
    typeof args[0] !== "string" ||
    !/^data:image\/[a-z0-9.+-]+;base64,/i.test(args[0])
  )) {
    throw new TypeError("Clipboard image data URL is invalid");
  }

  if (channel === CHANNELS.clipboardWriteSequence) {
    validatePasteSequencePayload(args[0], args[1]);
  }

  if (channel === CHANNELS.clipboardTransformText && (
    typeof args[0] !== "string" || args[0].length > 100000
    || !SUPPORTED_TRANSFORM_OPERATIONS.has(args[1])
    || (args[2] !== undefined && (!args[2] || typeof args[2] !== "object" || Array.isArray(args[2])))
  )) {
    throw new TypeError("Text transform payload is invalid");
  }

  if (channel === CHANNELS.imageAnalyze && (
    typeof args[0] !== "string"
    || !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]{1,16777216}$/i.test(args[0])
  )) {
    throw new TypeError("Image analysis data URL is invalid");
  }
}

const desktopBridge = {
  loadLibrary() {
    return ipcRenderer.invoke("library:load");
  },
  saveLibrary(library) {
    if (!library || typeof library !== "object") {
      throw new TypeError("Library payload must be an object");
    }

    return ipcRenderer.invoke("library:save", library);
  },
  listLibraryBackups() {
    return ipcRenderer.invoke("library:list-backups");
  },
  restoreLibraryBackup(backupName) {
    if (typeof backupName !== "string") {
      throw new TypeError("Backup name must be a string");
    }

    validatePayload(CHANNELS.libraryRestoreBackup, [backupName]);
    return ipcRenderer.invoke("library:restore-backup", backupName);
  },
  createLibrarySnapshot(library) {
    if (!library || typeof library !== "object") {
      throw new TypeError("Library payload must be an object");
    }

    return ipcRenderer.invoke("library:create-snapshot", library);
  },
  listLibrarySnapshots() {
    return ipcRenderer.invoke("library:list-snapshots");
  },
  verifyLibrarySnapshot(snapshotName) {
    if (typeof snapshotName !== "string") {
      throw new TypeError("Snapshot name must be a string");
    }

    validatePayload("library:verify-snapshot", [snapshotName]);
    return ipcRenderer.invoke("library:verify-snapshot", snapshotName);
  },
  restoreLibrarySnapshot(snapshotName, mode = "replace") {
    if (typeof snapshotName !== "string" || !["merge", "replace"].includes(mode)) {
      throw new TypeError("Snapshot name and restore mode are invalid");
    }

    validatePayload("library:restore-snapshot", [snapshotName, mode]);
    return ipcRenderer.invoke("library:restore-snapshot", snapshotName, mode);
  },
  listVersionHistory() {
    return ipcRenderer.invoke("library:list-version-history");
  },
  restoreVersionHistory(generation) {
    if (typeof generation !== "string") {
      throw new TypeError("Generation id must be a string");
    }

    validatePayload(CHANNELS.libraryRestoreVersionHistory, [generation]);
    return ipcRenderer.invoke("library:restore-version-history", generation);
  },
  getLibraryHealth(library) {
    if (!library || typeof library !== "object") {
      throw new TypeError("Library payload must be an object");
    }

    return ipcRenderer.invoke("library:health", library);
  },
  getAppHealth() {
    return ipcRenderer.invoke("library:app-health");
  },
  openMarkdownDirectory() {
    return ipcRenderer.invoke("library:open-markdown");
  },
  cleanupLibraryMedia(library) {
    if (!library || typeof library !== "object") {
      throw new TypeError("Library payload must be an object");
    }

    return ipcRenderer.invoke("library:cleanup-media", library);
  },
  writeLibraryImage(mediaKey, dataUrl) {
    if (typeof mediaKey !== "string" || typeof dataUrl !== "string") {
      throw new TypeError("Library image key and data URL are required");
    }

    validatePayload(CHANNELS.libraryWriteImage, [mediaKey, dataUrl]);
    return ipcRenderer.invoke("library:write-image", mediaKey, dataUrl);
  },
  readLibraryImage(mediaKey) {
    if (typeof mediaKey !== "string") {
      throw new TypeError("Library image key must be a string");
    }

    validatePayload(CHANNELS.libraryReadImage, [mediaKey]);
    return ipcRenderer.invoke("library:read-image", mediaKey);
  },
  deleteLibraryImage(mediaKey) {
    if (typeof mediaKey !== "string") {
      throw new TypeError("Library image key must be a string");
    }

    validatePayload(CHANNELS.libraryDeleteImage, [mediaKey]);
    return ipcRenderer.invoke("library:delete-image", mediaKey);
  },
  startImageDrag(mediaKey) {
    if (typeof mediaKey !== "string") {
      throw new TypeError("Image media key must be a string");
    }

    validatePayload(CHANNELS.dragImage, [mediaKey]);
    ipcRenderer.send("drag:image", mediaKey);
  },
  openLinkGroup(links) {
    if (!Array.isArray(links)) {
      throw new TypeError("Link group must be an array");
    }

    return ipcRenderer.invoke("links:open-group", links);
  },
  readClipboard() {
    return ipcRenderer.invoke("clipboard:read");
  },
  onClipboardChanged(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Clipboard change callback must be a function");
    }

    ipcRenderer.on("clipboard:changed", (_event, payload) => callback(payload));
  },
  writeText(text) {
    if (typeof text !== "string") {
      throw new TypeError("Clipboard text must be a string");
    }

    return ipcRenderer.invoke("clipboard:write-text", text);
  },
  writeImage(dataUrl) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      throw new TypeError("Clipboard image must be an image data URL");
    }

    validatePayload(CHANNELS.clipboardWriteImage, [dataUrl]);
    return ipcRenderer.invoke("clipboard:write-image", dataUrl);
  },
  writePasteSequence(entries, options) {
    validatePasteSequencePayload(entries, options);
    const safeEntries = entries.map((entry) => typeof entry === "string"
      ? entry
      : { id: entry.id, text: entry.text });
    validatePayload(CHANNELS.clipboardWriteSequence, [safeEntries, options]);
    return ipcRenderer.invoke("clipboard:write-sequence", safeEntries, options);
  },
  transformText(text, operation, options) {
    validatePayload(CHANNELS.clipboardTransformText, [text, operation, options]);
    return ipcRenderer.invoke("clipboard:transform-text", text, operation, options);
  },
  analyzeImage(dataUrl) {
    validatePayload(CHANNELS.imageAnalyze, [dataUrl]);
    return ipcRenderer.invoke("image:analyze", dataUrl);
  },
  rebuildOcrIndex(library) {
    if (!library || typeof library !== "object" || Array.isArray(library)) {
      throw new TypeError("Library payload must be an object");
    }

    return ipcRenderer.invoke("ocr:index-rebuild", library);
  },
  minimizeWindow() {
    return ipcRenderer.invoke("window:minimize");
  },
  closeWindow() {
    return ipcRenderer.invoke("window:close");
  },
  toggleWindowVisibility() {
    return ipcRenderer.invoke("window:toggle-visibility");
  },
  setGlobalShortcutEnabled(enabled, accelerator) {
    if (typeof enabled !== "boolean") {
      throw new TypeError("Global shortcut state must be boolean");
    }

    const normalizedAccelerator = accelerator === undefined ? undefined : normalizeGlobalShortcut(accelerator);
    if (accelerator !== undefined && !normalizedAccelerator) {
      throw new TypeError("Global shortcut accelerator must include supported modifiers and a key");
    }

    return accelerator === undefined
      ? ipcRenderer.invoke("window:set-global-shortcut", enabled)
      : ipcRenderer.invoke("window:set-global-shortcut", enabled, normalizedAccelerator);
  },
  setAlwaysOnTop(enabled) {
    if (typeof enabled !== "boolean") {
      throw new TypeError("Always-on-top state must be boolean");
    }

    return ipcRenderer.invoke("window:set-always-on-top", enabled);
  },
  getAlwaysOnTop() {
    return ipcRenderer.invoke("window:get-always-on-top");
  },
  startColorPicker() {
    return ipcRenderer.invoke("color-picker:start");
  },
  onColorPicked(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Color picker callback must be a function");
    }

    ipcRenderer.on("color-picker:result", (_event, payload) => callback(payload));
  },
  startOcrPicker() {
    return ipcRenderer.invoke("ocr-picker:start");
  },
  onOcrResult(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("OCR callback must be a function");
    }

    ipcRenderer.on("ocr-picker:result", (_event, payload) => callback(payload));
  },
  onLibraryConflict(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Library conflict callback must be a function");
    }

    ipcRenderer.on("library:conflict", (_event, payload) => callback(payload));
  },
  onQuickPaletteRequested(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Quick palette callback must be a function");
    }

    ipcRenderer.on("quick-palette:request", () => callback());
  },
  setKeyboardLocked(locked) {
    if (typeof locked !== "boolean") {
      throw new TypeError("Keyboard lock state must be boolean");
    }

    return ipcRenderer.invoke("keyboard-lock:set", locked);
  },
  getKeyboardLockStatus() {
    return ipcRenderer.invoke("keyboard-lock:status");
  },
  onKeyboardLockChanged(callback) {
    if (typeof callback !== "function") {
      throw new TypeError("Keyboard lock callback must be a function");
    }

    ipcRenderer.on("keyboard-lock:changed", (_event, payload) => callback(payload));
  }
};

contextBridge.exposeInMainWorld("desktopBridge", Object.freeze(desktopBridge));
