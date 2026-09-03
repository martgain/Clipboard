const { normalizeGlobalShortcut } = require("./accelerator.js");

const SUPPORTED_TRANSFORM_OPERATIONS = new Set([
  "whitespace-cleanup", "uppercase", "lowercase", "quotes-straighten",
  "quotes-smart", "bullets-to-numbered", "numbered-to-bullets"
]);

const CHANNELS = Object.freeze({
  libraryLoad: "library:load", librarySave: "library:save", libraryListBackups: "library:list-backups",
  libraryRestoreBackup: "library:restore-backup", libraryCleanupMedia: "library:cleanup-media",
  libraryCreateSnapshot: "library:create-snapshot", libraryListSnapshots: "library:list-snapshots",
  libraryVerifySnapshot: "library:verify-snapshot", libraryRestoreSnapshot: "library:restore-snapshot",
  libraryListVersionHistory: "library:list-version-history", libraryRestoreVersionHistory: "library:restore-version-history",
  libraryHealth: "library:health", libraryAppHealth: "library:app-health", libraryOpenMarkdown: "library:open-markdown", libraryConflict: "library:conflict",
  libraryWriteImage: "library:write-image", libraryReadImage: "library:read-image",
  libraryDeleteImage: "library:delete-image", dragImage: "drag:image", linksOpenGroup: "links:open-group",
  clipboardRead: "clipboard:read", clipboardWriteText: "clipboard:write-text", clipboardWriteImage: "clipboard:write-image",
  clipboardWriteSequence: "clipboard:write-sequence", clipboardTransformText: "clipboard:transform-text",
  imageAnalyze: "image:analyze", ocrIndexRebuild: "ocr:index-rebuild",
  windowMinimize: "window:minimize", windowClose: "window:close", windowToggleVisibility: "window:toggle-visibility",
  windowSetGlobalShortcut: "window:set-global-shortcut", windowSetAlwaysOnTop: "window:set-always-on-top",
  windowGetAlwaysOnTop: "window:get-always-on-top", colorPickerStart: "color-picker:start",
  colorPickerPick: "color-picker:pick", colorPickerCancel: "color-picker:cancel", colorPickerResult: "color-picker:result",
  clipboardChanged: "clipboard:changed", ocrPickerStart: "ocr-picker:start",
  ocrPickerSelect: "ocr-picker:select", ocrPickerCancel: "ocr-picker:cancel", ocrPickerResult: "ocr-picker:result",
  quickPaletteRequested: "quick-palette:request",
  keyboardLockSet: "keyboard-lock:set", keyboardLockStatus: "keyboard-lock:status", keyboardLockChanged: "keyboard-lock:changed"
});

const INVOKE_CHANNELS = new Set([
  CHANNELS.libraryLoad, CHANNELS.librarySave, CHANNELS.libraryListBackups, CHANNELS.libraryRestoreBackup,
  CHANNELS.libraryCleanupMedia, CHANNELS.libraryWriteImage, CHANNELS.libraryReadImage, CHANNELS.libraryDeleteImage,
  CHANNELS.libraryCreateSnapshot, CHANNELS.libraryListSnapshots, CHANNELS.libraryVerifySnapshot,
  CHANNELS.libraryRestoreSnapshot, CHANNELS.libraryListVersionHistory, CHANNELS.libraryRestoreVersionHistory,
  CHANNELS.libraryHealth, CHANNELS.libraryAppHealth, CHANNELS.libraryOpenMarkdown,
  CHANNELS.linksOpenGroup, CHANNELS.clipboardRead, CHANNELS.clipboardWriteText, CHANNELS.clipboardWriteImage,
  CHANNELS.clipboardWriteSequence, CHANNELS.clipboardTransformText, CHANNELS.imageAnalyze, CHANNELS.ocrIndexRebuild,
  CHANNELS.windowMinimize, CHANNELS.windowClose, CHANNELS.windowToggleVisibility, CHANNELS.windowSetGlobalShortcut,
  CHANNELS.windowSetAlwaysOnTop, CHANNELS.windowGetAlwaysOnTop, CHANNELS.colorPickerStart, CHANNELS.ocrPickerStart,
  CHANNELS.keyboardLockSet, CHANNELS.keyboardLockStatus
]);
const SEND_CHANNELS = new Set([
  CHANNELS.dragImage, CHANNELS.colorPickerPick, CHANNELS.colorPickerCancel, CHANNELS.ocrPickerSelect, CHANNELS.ocrPickerCancel
]);
const EVENT_CHANNELS = new Set([
  CHANNELS.clipboardChanged, CHANNELS.colorPickerResult, CHANNELS.ocrPickerResult,
  CHANNELS.libraryConflict, CHANNELS.quickPaletteRequested,
  CHANNELS.keyboardLockChanged
]);
const PATH_RULES = Object.freeze({
  media: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  backup: /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,
  generation: /^gen-\d{13}-[a-f0-9]{12}$/
});
function assertSafeName(candidate, kind) {
  if (typeof candidate !== "string" || !PATH_RULES[kind].test(candidate) || candidate.includes("..")) {
    throw new TypeError(`${kind} path is invalid`);
  }
}

function assertPasteSequencePayload(args) {
  const [entries, options] = args;
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

  assertPasteSequenceOptions(options);
}

function assertPasteSequenceOptions(options) {
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
  if (!Object.values(CHANNELS).includes(channel)) throw new TypeError("Unknown IPC channel");
  if ([CHANNELS.libraryReadImage, CHANNELS.libraryDeleteImage, CHANNELS.libraryWriteImage, CHANNELS.dragImage].includes(channel)) assertSafeName(args[0], "media");
  if ([CHANNELS.libraryRestoreBackup, CHANNELS.libraryVerifySnapshot, CHANNELS.libraryRestoreSnapshot].includes(channel)) assertSafeName(args[0], "backup");
  if (channel === CHANNELS.libraryRestoreVersionHistory) assertSafeName(args[0], "generation");
  if ([CHANNELS.librarySave, CHANNELS.libraryCleanupMedia, CHANNELS.libraryCreateSnapshot, CHANNELS.libraryHealth, CHANNELS.ocrIndexRebuild].includes(channel) && (!args[0] || typeof args[0] !== "object" || Array.isArray(args[0]))) throw new TypeError("Library payload must be an object");
  if (channel === CHANNELS.libraryRestoreSnapshot && !["merge", "replace"].includes(args[1])) throw new TypeError("Backup restore mode is invalid");
  if (channel === CHANNELS.libraryWriteImage && (typeof args[0] !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(args[1] || ""))) throw new TypeError("Library image key and data URL are required");
  if (channel === CHANNELS.clipboardWriteText && typeof args[0] !== "string") throw new TypeError("Clipboard text must be a string");
  if (channel === CHANNELS.clipboardWriteImage && (typeof args[0] !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(args[0]))) throw new TypeError("Clipboard image must be an image data URL");
  if (channel === CHANNELS.clipboardWriteSequence) assertPasteSequencePayload(args);
  if (channel === CHANNELS.clipboardTransformText) {
    if (typeof args[0] !== "string" || args[0].length > 100000 || !SUPPORTED_TRANSFORM_OPERATIONS.has(args[1])) {
      throw new TypeError("Text transform payload is invalid");
    }
    if (args[2] !== undefined && (!args[2] || typeof args[2] !== "object" || Array.isArray(args[2]))) {
      throw new TypeError("Text transform options are invalid");
    }
  }
  if (channel === CHANNELS.imageAnalyze) {
    if (typeof args[0] !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]{1,16777216}$/i.test(args[0])) {
      throw new TypeError("Image analysis data URL is invalid");
    }
  }
  if ([CHANNELS.windowSetGlobalShortcut, CHANNELS.windowSetAlwaysOnTop].includes(channel) && typeof args[0] !== "boolean") throw new TypeError("Window state must be boolean");
  if (channel === CHANNELS.windowSetGlobalShortcut && args.length > 1 && !normalizeGlobalShortcut(args[1])) throw new TypeError("Global shortcut must include supported modifiers and a key");
  if (channel === CHANNELS.linksOpenGroup && !Array.isArray(args[0])) throw new TypeError("Link group must be an array");
  if (channel === CHANNELS.keyboardLockSet && typeof args[0] !== "boolean") throw new TypeError("Keyboard lock state must be boolean");
  return args;
}

module.exports = Object.freeze({ CHANNELS, EVENT_CHANNELS, INVOKE_CHANNELS, SEND_CHANNELS, validatePayload, assertSafeName, normalizeGlobalShortcut });
