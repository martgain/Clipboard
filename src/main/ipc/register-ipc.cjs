const { CHANNELS, validatePayload } = require("../../shared/contracts.cjs");

function resolveMainWindow(mainWindow, getMainWindow) {
  return typeof getMainWindow === "function" ? getMainWindow() : mainWindow;
}

function assertTrusted(event, mainWindow, getMainWindow) {
  const trustedWindow = resolveMainWindow(mainWindow, getMainWindow);

  if (!trustedWindow || event.sender !== trustedWindow.webContents) throw new Error("Untrusted renderer request");
}

function registerIpc({ mainWindow, getMainWindow, services, ipcMain }) {
  const assertCurrentTrusted = (event) => assertTrusted(event, mainWindow, getMainWindow);
  const invoke = (channel, service, validate = true) => ipcMain.handle(channel, (event, ...args) => {
    assertCurrentTrusted(event);
    if (validate) validatePayload(channel, args);
    return services[service](...args);
  });
  invoke(CHANNELS.libraryLoad, "loadLibrary");
  invoke(CHANNELS.librarySave, "saveLibrary");
  invoke(CHANNELS.libraryListBackups, "listBackups");
  invoke(CHANNELS.libraryRestoreBackup, "restoreBackup");
  invoke(CHANNELS.libraryCleanupMedia, "cleanupMedia");
  invoke(CHANNELS.libraryCreateSnapshot, "createBackupSnapshot");
  invoke(CHANNELS.libraryListSnapshots, "listBackupSnapshots");
  invoke(CHANNELS.libraryVerifySnapshot, "verifyBackupSnapshot");
  invoke(CHANNELS.libraryRestoreSnapshot, "restoreBackupSnapshot");
  invoke(CHANNELS.libraryListVersionHistory, "listVersionHistory");
  invoke(CHANNELS.libraryRestoreVersionHistory, "restoreVersionHistory");
  invoke(CHANNELS.libraryHealth, "getStorageHealth");
  invoke(CHANNELS.libraryAppHealth, "getAppHealth");
  invoke(CHANNELS.libraryOpenMarkdown, "openMarkdownDirectory");
  invoke(CHANNELS.libraryWriteImage, "writeImage");
  invoke(CHANNELS.libraryReadImage, "readImage");
  invoke(CHANNELS.libraryDeleteImage, "deleteImage");
  invoke(CHANNELS.linksOpenGroup, "openLinkGroup");
  invoke(CHANNELS.clipboardRead, "readClipboard");
  invoke(CHANNELS.clipboardWriteText, "writeText");
  invoke(CHANNELS.clipboardWriteImage, "writeImageToClipboard");
  invoke(CHANNELS.clipboardWriteSequence, "writePasteSequence");
  invoke(CHANNELS.clipboardTransformText, "transformText");
  invoke(CHANNELS.imageAnalyze, "analyzeImage");
  invoke(CHANNELS.ocrIndexRebuild, "rebuildOcrIndex");
  invoke(CHANNELS.windowMinimize, "minimizeWindow");
  invoke(CHANNELS.windowClose, "closeWindow");
  invoke(CHANNELS.windowToggleVisibility, "toggleWindowVisibility");
  invoke(CHANNELS.windowSetGlobalShortcut, "setGlobalShortcutEnabled");
  invoke(CHANNELS.windowSetAlwaysOnTop, "setAlwaysOnTop");
  invoke(CHANNELS.windowGetAlwaysOnTop, "getAlwaysOnTop");
  invoke(CHANNELS.colorPickerStart, "startColorPicker");
  invoke(CHANNELS.ocrPickerStart, "startOcrPicker");
  invoke(CHANNELS.keyboardLockSet, "setKeyboardLocked");
  invoke(CHANNELS.keyboardLockStatus, "getKeyboardLockStatus");
  ipcMain.on(CHANNELS.dragImage, (event, ...args) => {
    const trustedWindow = resolveMainWindow(mainWindow, getMainWindow);
    if (!trustedWindow || event.sender !== trustedWindow.webContents) return;
    validatePayload(CHANNELS.dragImage, args);
    services.startImageDrag(...args, event);
  });
  if (Object.prototype.hasOwnProperty.call(services, "registerPickerEvents")) {
    services.registerPickerEvents({ ipcMain, assertTrusted: assertCurrentTrusted, validatePayload });
  }
}

module.exports = { registerIpc };
