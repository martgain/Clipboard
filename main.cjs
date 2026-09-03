const { app, BrowserWindow, ClipboardItem, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } = require("electron");
const { execFileSync, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createLibraryStore } = require("./library-store.cjs");
const { prepareLinkGroupUrls } = require("./link-launcher.cjs");
const { createImageDragFile } = require("./image-drag.cjs");
const { bgraPixelToColor } = require("./color-picker.cjs");
const {
  normalizeScreenRect,
  scaleRectToThumbnail,
  hasVisiblePixels
} = require("./ocr-capture.cjs");
const { recognizeOcrText, terminateOcrWorker } = require("./ocr-engine.cjs");
const { getOcrResizeSize } = require("./ocr-preprocess.cjs");
const { registerIpc } = require("./src/main/ipc/register-ipc.cjs");
const { WindowController } = require("./src/main/window-controller.cjs");
const { ClipboardAdapter } = require("./src/main/clipboard-adapter.cjs");
const { BackupStore } = require("./src/main/storage/backup-store.cjs");
const { MarkdownWatcher } = require("./src/main/storage/markdown-watcher.cjs");
const { StorageHealth } = require("./src/main/storage/storage-health.cjs");
const { OcrService } = require("./src/main/ocr/ocr-service.cjs");
const { OnnxOcrClient } = require("./src/main/ocr/onnx-ocr-client.cjs");
const { AppHealth } = require("./src/main/release/app-health.cjs");
const { createFeatureServices } = require("./src/main/feature-services.cjs");
const { ShortcutRegistry } = require("./src/main/shortcut-registry.cjs");
const { normalizeGlobalShortcut } = require("./src/shared/contracts.cjs");
const { WindowsListenerClient } = require("./src/main/clipboard/windows-listener-client.cjs");
const { KeyboardLockClient } = require("./src/main/keyboard-lock-client.cjs");
const { ElectronClipboardAdapter } = require("./src/main/clipboard/electron-clipboard-adapter.cjs");
const {
  readClipboardSnapshot,
  snapshotToPayload
} = require("./src/main/clipboard/runtime-clipboard.cjs");
const { CHANNELS } = require("./src/shared/contracts.cjs");

const DEFAULT_WINDOW_PREFERENCES = {
  width: 355,
  height: 611,
  x: undefined,
  y: undefined,
  alwaysOnTop: true
};
const MIN_WINDOW_WIDTH = 210;
const MIN_WINDOW_HEIGHT = 260;
const CLIPBOARD_POLL_INTERVAL_MS = 350;
const OCR_CAPTURE_ATTEMPTS = 3;
const OCR_RETRY_DELAY_MS = 120;
const PREFERENCES_VERSION = 4;
const GLOBAL_SHORTCUT = "CommandOrControl+Shift+Space";
const clipboardAdapter = new ClipboardAdapter({ clipboard, ClipboardItem, Blob: globalThis.Blob });
const richClipboardAdapter = new ElectronClipboardAdapter({ clipboard, ClipboardItem, Blob: globalThis.Blob });
const onnxOcrClient = new OnnxOcrClient();
const ocrService = new OcrService({
  onnxClient: onnxOcrClient,
  tesseractClient: {
    async recognize(imageBuffer) {
      return {
        text: await recognizeOcrText(imageBuffer),
        engine: "tesseract",
        language: "ara+eng"
      };
    }
  }
});

let mainWindow = null;
let windowPreferences = { ...DEFAULT_WINDOW_PREFERENCES };
let clipboardListenerClient = null;
let keyboardLockClient = null;
let clipboardReadInFlight = false;
let lastClipboardSignature = null;
let libraryStore = null;
let backupStore = null;
let storageHealth = null;
let markdownWatcher = null;
let appHealth = null;
let featureServices = null;
let featureServicesClosePromise = null;
let lastLibrarySaveAt = 0;
let lastIntegrityAt = 0;
let extractedIpcRegistered = false;
const gotSingleInstanceLock = app.requestSingleInstanceLock();
let tray = null;
const colorPickerWindows = new Set();
let colorPickerActive = false;
const ocrPickerWindows = new Set();
const ocrPickerDisplays = new Map();
let ocrPickerActive = false;
let globalShortcutAccelerator = GLOBAL_SHORTCUT;
const shortcutRegistry = new ShortcutRegistry({
  defaults: { toggleVisibility: GLOBAL_SHORTCUT },
  register: (shortcut) => globalShortcut.register(shortcut, requestQuickPalette),
  unregister: (shortcut) => globalShortcut.unregister(shortcut)
});

function preferencesFilePath() {
  return path.join(app.getPath("userData"), "window-preferences.json");
}

function storagePaths() {
  const userDataPath = app.getPath("userData");
  const storageDirectory = path.join(userDataPath, "clipboard-shelf-data");
  const markdownDirectory = path.join(storageDirectory, "markdown");

  return {
    userDataPath,
    storageDirectory,
    markdownDirectory,
    groupsDirectory: path.join(markdownDirectory, "groups"),
    mediaDirectory: path.join(storageDirectory, "media"),
    legacyMediaDirectory: path.join(userDataPath, "media"),
    backupDirectory: path.join(storageDirectory, "backups"),
    ocrIndexFile: path.join(storageDirectory, "ocr-index.json"),
    transactionDirectory: path.join(markdownDirectory, ".transactions"),
    dragDirectory: path.join(app.getPath("temp"), "clipboard-shelf-drag")
  };
}

function getLibraryStore() {
  if (!libraryStore) {
    const paths = storagePaths();
    libraryStore = createLibraryStore({
      dataFile: path.join(paths.storageDirectory, "library.json"),
      legacyDataFile: path.join(paths.userDataPath, "library.json"),
      markdownDirectory: paths.markdownDirectory,
      mediaDirectory: paths.mediaDirectory,
      legacyMediaDirectory: paths.legacyMediaDirectory,
      backupDirectory: paths.backupDirectory
    });
  }

  return libraryStore;
}

function getFeatureServices() {
  if (!featureServices) {
    const paths = storagePaths();
    featureServices = createFeatureServices({
      getLibraryStore,
      writeClipboardText: async (text) => {
        await clipboardAdapter.writeText(text);
        await rememberCurrentClipboard();
      },
      ocrIndexPath: paths.ocrIndexFile
    });
  }

  return featureServices;
}

function deferQuitUntilFeatureServicesClose(event) {
  if (!featureServices || featureServicesClosePromise) {
    return false;
  }

  event.preventDefault();
  featureServicesClosePromise = featureServices.close()
    .catch((closeError) => console.warn("تعذر إغلاق فهرس OCR بأمان.", closeError))
    .finally(() => app.quit());
  return true;
}

function getBackupStore() {
  if (!backupStore) {
    const paths = storagePaths();
    backupStore = new BackupStore({
      backupDirectory: paths.backupDirectory,
      markdownDirectory: paths.markdownDirectory,
      groupsDirectory: paths.groupsDirectory,
      mediaDirectory: paths.mediaDirectory,
      legacyMediaDirectory: paths.legacyMediaDirectory
    });
  }

  return backupStore;
}

function getStorageHealth() {
  if (!storageHealth) {
    const paths = storagePaths();
    storageHealth = new StorageHealth({
      markdownDirectory: paths.markdownDirectory,
      mediaDirectory: paths.mediaDirectory,
      transactionDirectory: paths.transactionDirectory,
      backupDirectory: paths.backupDirectory,
      dragDirectory: paths.dragDirectory
    });
  }

  return storageHealth;
}

function getAppHealth() {
  if (!appHealth) {
    appHealth = new AppHealth({
      version: app.getVersion(),
      commit: process.env.CLIPBOARD_SHELF_COMMIT || "local",
      helperStatus: clipboardListenerClient?.getStatus().mode || "stopped",
      storageHealth: getStorageHealth(),
      timestamps: {
        get lastSaveAt() {
          return lastLibrarySaveAt;
        },
        get lastIntegrityAt() {
          return lastIntegrityAt;
        }
      }
    });
  }

  appHealth.helperStatus = clipboardListenerClient?.getStatus().mode || "stopped";
  return appHealth;
}

function startMarkdownWatcher() {
  if (markdownWatcher) {
    return;
  }

  const paths = storagePaths();
  fs.mkdirSync(paths.markdownDirectory, { recursive: true });
  fs.mkdirSync(paths.groupsDirectory, { recursive: true });
  markdownWatcher = new MarkdownWatcher({
    markdownFile: path.join(paths.markdownDirectory, "library.md"),
    groupsDirectory: paths.groupsDirectory,
    onConflict: (change) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("library:conflict", change);
      }
    }
  });
  markdownWatcher.start();
}

function stopMarkdownWatcher() {
  markdownWatcher?.stop();
  markdownWatcher = null;
}

async function openMarkdownDirectory() {
  const paths = storagePaths();
  fs.mkdirSync(paths.markdownDirectory, { recursive: true });
  const error = await shell.openPath(paths.markdownDirectory);
  return { opened: error === "", path: paths.markdownDirectory, error: error || null };
}

function readWindowPreferences() {
  try {
    const rawPreferences = JSON.parse(fs.readFileSync(preferencesFilePath(), "utf8"));

    if (rawPreferences.version !== PREFERENCES_VERSION) {
      return { ...DEFAULT_WINDOW_PREFERENCES };
    }

    return {
      width: restoreWindowDimension(rawPreferences.width, DEFAULT_WINDOW_PREFERENCES.width, MIN_WINDOW_WIDTH),
      height: restoreWindowDimension(rawPreferences.height, DEFAULT_WINDOW_PREFERENCES.height, MIN_WINDOW_HEIGHT),
      x: validWindowPosition(rawPreferences.x) ? rawPreferences.x : undefined,
      y: validWindowPosition(rawPreferences.y) ? rawPreferences.y : undefined,
      alwaysOnTop: rawPreferences.alwaysOnTop !== false
    };
  } catch (preferencesError) {
    return { ...DEFAULT_WINDOW_PREFERENCES };
  }
}

function saveWindowPreferences() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const bounds = mainWindow.getBounds();
  const nextPreferences = {
    version: PREFERENCES_VERSION,
    width: Math.max(MIN_WINDOW_WIDTH, bounds.width - 1),
    height: Math.max(MIN_WINDOW_HEIGHT, bounds.height - 1),
    x: bounds.x,
    y: bounds.y,
    alwaysOnTop: mainWindow.isAlwaysOnTop()
  };

  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(preferencesFilePath(), JSON.stringify(nextPreferences, null, 2), "utf8");
    windowPreferences = nextPreferences;
  } catch (saveError) {
    console.warn("تعذر حفظ تفضيلات نافذة التطبيق المحلية.", saveError);
  }
}

function restoreWindowDimension(candidate, fallback, minimum) {
  return Number.isInteger(candidate) && candidate >= minimum ? candidate : fallback;
}

function validWindowPosition(candidate) {
  return Number.isInteger(candidate);
}

function fitWindowPreferencesToDisplay(preferences) {
  const display = screen.getDisplayNearestPoint({
    x: preferences.x ?? 0,
    y: preferences.y ?? 0
  });
  const workArea = display.workArea;
  const maximumX = Math.max(workArea.x, workArea.x + workArea.width - preferences.width);
  const maximumY = Math.max(workArea.y, workArea.y + workArea.height - preferences.height);

  return {
    ...preferences,
    x: validWindowPosition(preferences.x) ? Math.min(Math.max(preferences.x, workArea.x), maximumX) : undefined,
    y: validWindowPosition(preferences.y) ? Math.min(Math.max(preferences.y, workArea.y), maximumY) : undefined
  };
}

function localRendererUrl() {
  return pathToFileURL(path.join(__dirname, "clipboard-shelf.html")).toString();
}

async function readNativeClipboard() {
  return clipboardSnapshotPayload(await readNativeClipboardSnapshot());
}

async function readNativeClipboardSnapshot(clipboardEvent = null) {
  return readClipboardSnapshot({
    richAdapter: richClipboardAdapter,
    fallbackAdapter: clipboardAdapter,
    event: clipboardEvent
  });
}

function clipboardSnapshotPayload(snapshot) {
  if (snapshot && snapshot.payload) {
    return snapshotToPayload(snapshot);
  }

  return snapshot.createPayload();
}

function resolveClipboardHelperPath() {
  const candidates = [
    process.env.CLIPBOARD_SHELF_HELPER_PATH,
    process.resourcesPath && path.join(process.resourcesPath, "native", "clipboard-listener.exe"),
    process.resourcesPath && path.join(process.resourcesPath, "clipboard-listener.exe"),
    path.join(__dirname, "native", "windows-bridge", "clipboard-listener.exe")
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function resolveKeyboardLockHelperPath() {
  const candidates = [
    process.env.CLIPBOARD_SHELF_KEYBOARD_LOCK_HELPER_PATH,
    process.resourcesPath && path.join(process.resourcesPath, "keyboard-locker.ps1"),
    path.join(__dirname, "native", "windows-bridge", "keyboard-locker.ps1")
  ].filter((candidate) => typeof candidate === "string" && candidate.length > 0);

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getKeyboardLockClient() {
  if (!keyboardLockClient) {
    keyboardLockClient = new KeyboardLockClient({
      platform: process.platform,
      helperPath: resolveKeyboardLockHelperPath(),
      onStateChange: (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(CHANNELS.keyboardLockChanged, status);
        }
      },
      logger: (details) => console.warn("تعذر تشغيل قفل لوحة المفاتيح.", details)
    });
  }

  return keyboardLockClient;
}

async function setKeyboardLocked(locked) {
  return getKeyboardLockClient().setLocked(locked);
}

function getKeyboardLockStatus() {
  return getKeyboardLockClient().getStatus();
}

async function stopKeyboardLockClient() {
  if (keyboardLockClient) {
    await keyboardLockClient.stop();
    keyboardLockClient = null;
  }
}

function startClipboardMonitor() {
  if (clipboardListenerClient && clipboardListenerClient.getStatus().mode !== "stopped") {
    return;
  }

  void primeClipboardSignature();
  clipboardListenerClient = new WindowsListenerClient({
    platform: process.platform,
    helperPath: resolveClipboardHelperPath(),
    poll: pollNativeClipboard,
    initialPollIntervalMs: CLIPBOARD_POLL_INTERVAL_MS,
    logger: (details) => console.warn("تعذر تشغيل مستمع الحافظة؛ سيستمر المسار البديل.", details)
  });
  void clipboardListenerClient.start((clipboardEvent) => pollNativeClipboard(clipboardEvent)).catch((clipboardStartError) => {
    console.warn("تعذر بدء مراقبة الحافظة تلقائيًا.", clipboardStartError);
  });
}

async function primeClipboardSignature() {
  if (clipboardReadInFlight) {
    return;
  }

  clipboardReadInFlight = true;

  try {
    const snapshot = await readNativeClipboardSnapshot();
    lastClipboardSignature = snapshot.signature;
  } catch (clipboardError) {
    lastClipboardSignature = null;
    console.warn("تعذر قراءة الحافظة عند بدء المراقبة؛ ستتم إعادة المحاولة.", clipboardError);
  } finally {
    clipboardReadInFlight = false;
  }
}

function stopClipboardMonitor() {
  if (clipboardListenerClient) {
    clipboardListenerClient.stop();
    clipboardListenerClient = null;
  }

  lastClipboardSignature = null;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function toggleMainWindowVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isVisible()) {
    mainWindow.hide();
    return;
  }

  showMainWindow();
}

function createTrayIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#b42318"/><path d="M9 10h14v12H9z" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 14h8M12 18h5" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>`;
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
}

function createTray() {
  if (process.platform !== "win32" || tray) {
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip("رف الحافظة");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "إظهار الرف", click: showMainWindow },
    { label: "إخفاء الرف", click: () => mainWindow?.hide() },
    { type: "separator" },
    { label: "خروج", click: () => app.quit() }
  ]));
  tray.on("click", toggleMainWindowVisibility);
}

function requestQuickPalette() {
  showMainWindow();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(CHANNELS.quickPaletteRequested);
  }
}

function setGlobalShortcutEnabled(enabled, accelerator) {
  if (typeof enabled !== "boolean") {
    throw new TypeError("Global shortcut state must be boolean");
  }

  const requestedAccelerator = accelerator === undefined
    ? globalShortcutAccelerator
    : normalizeGlobalShortcut(accelerator);

  if (enabled && !requestedAccelerator) {
    return false;
  }

  const applicationReport = shortcutRegistry.apply(enabled
    ? { toggleVisibility: requestedAccelerator }
    : {});

  if (!enabled) {
    return false;
  }

  const registered = applicationReport.applied.toggleVisibility === requestedAccelerator;
  if (registered) {
    globalShortcutAccelerator = requestedAccelerator;
  }
  return registered;
}

async function pollNativeClipboard(clipboardEvent = null) {
  if (!mainWindow || mainWindow.isDestroyed() || clipboardReadInFlight) {
    return;
  }

  clipboardReadInFlight = true;

  try {
    const snapshot = await readNativeClipboardSnapshot(clipboardEvent);

    if (snapshot.signature === lastClipboardSignature) {
      return;
    }

    lastClipboardSignature = snapshot.signature;
    const payload = clipboardSnapshotPayload(snapshot);

    if (payload.kind === "text" && payload.text.trim().length === 0) {
      return;
    }

    mainWindow.webContents.send("clipboard:changed", payload);
  } catch (clipboardError) {
    console.warn("تعذر فحص تغيّر الحافظة تلقائيًا.", clipboardError);
  } finally {
    clipboardReadInFlight = false;
  }
}

async function rememberCurrentClipboard() {
  try {
    lastClipboardSignature = (await readNativeClipboardSnapshot()).signature;
  } catch (clipboardError) {
    console.warn("تعذر تحديث حالة الحافظة المحلية.", clipboardError);
  }
}

function isColorPickerWindow(webContents) {
  return [...colorPickerWindows].some((pickerWindow) => pickerWindow.webContents === webContents);
}

function closeColorPickerWindows() {
  colorPickerActive = false;

  [...colorPickerWindows].forEach((pickerWindow) => {
    if (!pickerWindow.isDestroyed()) {
      pickerWindow.close();
    }
  });
  colorPickerWindows.clear();
}

function colorPickerWindowOptions(display) {
  return {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "color-picker-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

async function createColorPickerWindow(display) {
  const pickerWindow = new BrowserWindow(colorPickerWindowOptions(display));

  colorPickerWindows.add(pickerWindow);
  pickerWindow.on("closed", () => colorPickerWindows.delete(pickerWindow));
  await pickerWindow.loadFile(path.join(__dirname, "color-picker-overlay.html"));
  pickerWindow.setAlwaysOnTop(true, "screen-saver");
  pickerWindow.show();
  pickerWindow.focus();
  return pickerWindow;
}

async function startColorPicker() {
  if (colorPickerActive || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  colorPickerActive = true;
  mainWindow.hide();

  try {
    await Promise.all(screen.getAllDisplays().map(createColorPickerWindow));
    return true;
  } catch (error) {
    closeColorPickerWindows();
    showMainWindow();
    throw error;
  }
}

function findDisplaySource(sources, displays, display) {
  const displayIndex = displays.findIndex((candidate) => candidate.id === display.id);
  const displaySource = sources.find((source) => source.display_id === String(display.id));
  const candidates = [displaySource, sources[displayIndex], ...sources];
  return candidates.find((source) => source?.thumbnail && !source.thumbnail.isEmpty()) || null;
}

function screenCaptureOptions(display) {
  return {
    types: ["screen"],
    thumbnailSize: {
      width: Math.max(1, Math.round(display.bounds.width * display.scaleFactor)),
      height: Math.max(1, Math.round(display.bounds.height * display.scaleFactor))
    },
    fetchWindowIcons: false
  };
}

async function captureDisplaySource(display, displays) {
  const sources = await desktopCapturer.getSources(screenCaptureOptions(display));
  const source = findDisplaySource(sources, displays, display);

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error("Screen capture returned no image");
  }

  return source;
}

function cursorThumbnailPoint(cursorPoint, display, thumbnailSize) {
  const x = (cursorPoint.x - display.bounds.x) * thumbnailSize.width / display.bounds.width;
  const y = (cursorPoint.y - display.bounds.y) * thumbnailSize.height / display.bounds.height;
  return {
    width: thumbnailSize.width,
    height: thumbnailSize.height,
    x: Math.min(thumbnailSize.width - 1, Math.max(0, Math.floor(x))),
    y: Math.min(thumbnailSize.height - 1, Math.max(0, Math.floor(y)))
  };
}

function waitForScreenToSettle() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

async function readScreenColorAtCursor(cursorPoint = screen.getCursorScreenPoint()) {
  const displays = screen.getAllDisplays();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const source = await captureDisplaySource(display, displays);
  const thumbnailSize = source.thumbnail.getSize();
  const point = cursorThumbnailPoint(cursorPoint, display, thumbnailSize);

  return bgraPixelToColor(source.thumbnail.toBitmap(), point);
}

async function finishColorPick(event) {
  if (!isColorPickerWindow(event.sender)) {
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  closeColorPickerWindows();

  try {
    await waitForScreenToSettle();
    const color = await readScreenColorAtCursor(cursorPoint);
    await clipboardAdapter.writeText(color.hex);
    await rememberCurrentClipboard();
    mainWindow?.webContents.send("color-picker:result", color);
  } catch (error) {
    console.warn("تعذر قراءة لون الشاشة.", error);
    mainWindow?.webContents.send("color-picker:result", { error: "تعذر قراءة لون الشاشة." });
  } finally {
    showMainWindow();
  }
}

function getOcrPickerWindow(webContents) {
  return [...ocrPickerWindows].find((pickerWindow) => pickerWindow.webContents === webContents) || null;
}

function closeOcrPickerWindows() {
  ocrPickerActive = false;

  [...ocrPickerWindows].forEach((pickerWindow) => {
    if (!pickerWindow.isDestroyed()) {
      pickerWindow.close();
    }
  });
  ocrPickerWindows.clear();
  ocrPickerDisplays.clear();
}

function ocrPickerWindowBounds(display) {
  return {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height
  };
}

function ocrPickerWebPreferences() {
  return {
    preload: path.join(__dirname, "ocr-selection-preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true
  };
}

function ocrPickerWindowOptions(display) {
  return {
    ...ocrPickerWindowBounds(display),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: ocrPickerWebPreferences()
  };
}

async function createOcrPickerWindow(display) {
  const pickerWindow = new BrowserWindow(ocrPickerWindowOptions(display));

  ocrPickerWindows.add(pickerWindow);
  ocrPickerDisplays.set(pickerWindow, display);
  pickerWindow.on("closed", () => {
    ocrPickerWindows.delete(pickerWindow);
    ocrPickerDisplays.delete(pickerWindow);
  });
  await pickerWindow.loadFile(path.join(__dirname, "ocr-selection-overlay.html"));
  pickerWindow.setAlwaysOnTop(true, "screen-saver");
  pickerWindow.show();
  pickerWindow.focus();
  return pickerWindow;
}

async function startOcrPicker() {
  if (ocrPickerActive || !mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  ocrPickerActive = true;
  mainWindow.hide();

  try {
    await Promise.all(screen.getAllDisplays().map(createOcrPickerWindow));
    return true;
  } catch (error) {
    closeOcrPickerWindows();
    showMainWindow();
    throw error;
  }
}

function selectionFromPayload(payload, display) {
  if (!payload || !payload.start || !payload.end) {
    throw new TypeError("OCR selection points are required");
  }

  return normalizeScreenRect(payload.start, payload.end, display.bounds);
}

async function captureOcrSelection(display, selection) {
  const displays = screen.getAllDisplays();
  const source = await captureDisplaySource(display, displays);
  const thumbnail = source.thumbnail;
  const crop = scaleRectToThumbnail(selection, display.bounds, thumbnail.getSize());
  const croppedImage = thumbnail.crop(crop);

  if (!hasVisiblePixels(croppedImage.toBitmap())) {
    return null;
  }

  return resizeOcrImage(croppedImage).toPNG();
}

function resizeOcrImage(image) {
  const size = getOcrResizeSize(image.getSize());
  return image.resize({ width: size.width, height: size.height, quality: "best" });
}

function sendOcrResult(payload) {
  mainWindow?.webContents.send("ocr-picker:result", payload);
}

function getOcrSelectionOrNull(payload, display) {
  try {
    return selectionFromPayload(payload, display);
  } catch {
    return null;
  }
}

function rejectOcrSelection() {
  closeOcrPickerWindows();
  sendOcrResult({ error: "حدد مساحة أكبر قليلًا لقراءة النص." });
  showMainWindow();
}

async function captureAndRecognizeOcrSelection(display, selection) {
  const imageBuffer = await captureOcrSelectionWithRetry(display, selection);
  return ocrService.recognize(imageBuffer);
}

async function captureOcrSelectionWithRetry(display, selection) {
  for (let attempt = 0; attempt < OCR_CAPTURE_ATTEMPTS; attempt += 1) {
    await waitForScreenToSettle();
    const imageBuffer = await captureOcrSelection(display, selection);

    if (imageBuffer) {
      return imageBuffer;
    }

    if (attempt + 1 < OCR_CAPTURE_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, OCR_RETRY_DELAY_MS));
    }
  }

  const captureError = new Error("Screen capture is black or unavailable");
  captureError.code = "BLACK_SCREEN_CAPTURE";
  throw captureError;
}

async function finishOcrSelection(event, payload) {
  const pickerWindow = getOcrPickerWindow(event.sender);

  if (!pickerWindow || !ocrPickerActive) {
    return;
  }

  const display = ocrPickerDisplays.get(pickerWindow);
  const selection = getOcrSelectionOrNull(payload, display);

  if (!selection) {
    rejectOcrSelection();
    return;
  }

  closeOcrPickerWindows();

  try {
    const recognition = await captureAndRecognizeOcrSelection(display, selection);

    if (!recognition?.text) {
      throw new Error("OCR returned no text");
    }

    await clipboardAdapter.writeText(recognition.text);
    await rememberCurrentClipboard();
    sendOcrResult(recognition);
  } catch (ocrError) {
    console.warn("تعذر استخراج النص من الشاشة.", ocrError);
    const errorMessage = ocrError?.code === "BLACK_SCREEN_CAPTURE"
      ? "المتصفح حجب صورة الفيديو. أوقف Hardware Acceleration أو استخدم الترجمة الظاهرة."
      : "تعذر استخراج النص من الجزء المحدد.";
    sendOcrResult({ error: errorMessage });
  } finally {
    showMainWindow();
  }
}

function writeNativeImage(dataUrl) {
  return clipboardAdapter.writeImage(dataUrl);
}

function resolveChromeExecutable() {
  const candidates = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")
  ].filter(Boolean);

  const installedPath = candidates.find((candidate) => fs.existsSync(candidate));

  if (installedPath) {
    return installedPath;
  }

  try {
    return execFileSync("where.exe", ["chrome.exe"], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null;
  } catch (whereError) {
    return null;
  }
}

function launchChrome(chromeExecutable, links) {
  return new Promise((resolve, reject) => {
    const chromeProcess = spawn(chromeExecutable, ["--new-window", ...links], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });

    chromeProcess.once("error", reject);
    chromeProcess.once("spawn", () => {
      chromeProcess.unref();
      resolve();
    });
  });
}

async function openDefaultBrowser(links) {
  await Promise.all(links.map((link) => shell.openExternal(link)));
}

async function openLinkGroup(links) {
  if (!Array.isArray(links) || links.length === 0) {
    throw new TypeError("At least one link is required");
  }

  const validLinks = prepareLinkGroupUrls(links);

  const chromeExecutable = resolveChromeExecutable();

  if (chromeExecutable) {
    try {
      await launchChrome(chromeExecutable, validLinks);
      return { browser: "chrome", count: validLinks.length };
    } catch (chromeError) {
      console.warn("تعذر تشغيل Chrome، سيتم استخدام المتصفح الافتراضي.", chromeError);
    }
  }

  await openDefaultBrowser(validLinks);
  return { browser: "default", count: validLinks.length };
}

async function createMainWindow() {
  windowPreferences = fitWindowPreferencesToDisplay(readWindowPreferences());
  const controller = new WindowController({
    BrowserWindow, preloadPath: path.join(__dirname, "preload.cjs"),
    rendererPath: path.join(__dirname, "clipboard-shelf.html"), localRendererUrl: localRendererUrl(),
    preferences: windowPreferences,
    onCreated: (createdWindow) => {
      mainWindow = createdWindow;
      registerExtractedIpcHandlers();
    },
    onReady: () => mainWindow?.show(), onResize: saveWindowPreferences,
    onMove: saveWindowPreferences, onClosed: () => { stopClipboardMonitor(); void stopKeyboardLockClient(); mainWindow = null; }
  });
  mainWindow = await controller.createMain();
  mainWindow.setContentSize(windowPreferences.width, windowPreferences.height);
  startMarkdownWatcher();
  createTray();
  startClipboardMonitor();
}

function registerExtractedIpcHandlers() {
  if (extractedIpcRegistered) {
    return;
  }

  const store = () => getLibraryStore();
  const features = getFeatureServices();
  registerIpc({
    getMainWindow: () => mainWindow,
    ipcMain,
    services: {
      loadLibrary: () => ({ library: features.normalizeLibraryForLoad(store().load()), exists: store().hasData() }),
      saveLibrary: (library) => {
        const savedLibrary = store().save(features.prepareLibraryForSave(library));
        lastLibrarySaveAt = Date.now();
        markdownWatcher?.markLocalWrite();
        return savedLibrary;
      },
      listBackups: () => store().listBackups(),
      restoreBackup: (name) => {
        const restoredLibrary = store().restoreBackup(name);
        markdownWatcher?.markLocalWrite();
        return restoredLibrary;
      },
      createBackupSnapshot: (library) => getBackupStore().createSnapshot(library),
      listBackupSnapshots: () => getBackupStore().list(),
      verifyBackupSnapshot: (name) => getBackupStore().verifySnapshot(name),
      restoreBackupSnapshot: (name, mode) => {
        const restored = getBackupStore().restore(name, mode);
        const { library: restoredLibrary, ...result } = restored;
        store().save(restoredLibrary);
        markdownWatcher?.markLocalWrite();
        return result;
      },
      listVersionHistory: () => features.listVersionHistory(),
      restoreVersionHistory: (generation) => {
        const restoredLibrary = features.restoreVersionHistory(generation);
        markdownWatcher?.markLocalWrite();
        return restoredLibrary;
      },
      getStorageHealth: (library) => {
        lastIntegrityAt = Date.now();
        return getStorageHealth().scan(library);
      },
      getAppHealth: () => getAppHealth().collect(),
      openMarkdownDirectory,
      cleanupMedia: (library) => store().cleanupMedia(library), writeImage: (key, dataUrl) => store().writeImage(key, dataUrl),
      readImage: (key) => store().readImage(key), deleteImage: (key) => { store().deleteImage(key); return true; },
      openLinkGroup, readClipboard: readNativeClipboard,
      writeText: async (text) => { await clipboardAdapter.writeText(text); await rememberCurrentClipboard(); },
      writeImageToClipboard: async (dataUrl) => { await writeNativeImage(dataUrl); await rememberCurrentClipboard(); },
      writePasteSequence: (entries, options) => features.writePasteSequence(entries, options),
      transformText: (text, operation, options) => features.transformText(text, operation, options),
      analyzeImage: (dataUrl) => features.analyzeImage(dataUrl),
      rebuildOcrIndex: (library) => features.rebuildOcrIndex(library),
      minimizeWindow: () => mainWindow.minimize(), closeWindow: () => mainWindow.close(),
      toggleWindowVisibility: () => { toggleMainWindowVisibility(); return Boolean(mainWindow?.isVisible()); },
      setGlobalShortcutEnabled, setAlwaysOnTop: (enabled) => { mainWindow.setAlwaysOnTop(enabled); saveWindowPreferences(); return mainWindow.isAlwaysOnTop(); },
      getAlwaysOnTop: () => mainWindow.isAlwaysOnTop(), startColorPicker, startOcrPicker,
      setKeyboardLocked, getKeyboardLockStatus,
      startImageDrag: (key, event) => {
        const dataUrl = store().readImage(key);
        if (!dataUrl) return;
        const dragFile = createImageDragFile(key, dataUrl, path.join(app.getPath("temp"), "clipboard-shelf-drag"));
        event.sender.startDrag({ file: dragFile.filePath, icon: dragFile.filePath });
      },
      registerPickerEvents: ({ ipcMain: pickerIpc, assertTrusted }) => {
        pickerIpc.on("color-picker:pick", (event) => { if (!isColorPickerWindow(event.sender)) return; void finishColorPick(event); });
        pickerIpc.on("color-picker:cancel", (event) => { if (!isColorPickerWindow(event.sender)) return; closeColorPickerWindows(); mainWindow?.webContents.send("color-picker:result", { cancelled: true }); showMainWindow(); });
        pickerIpc.on("ocr-picker:select", (event, payload) => { if (!getOcrPickerWindow(event.sender)) return; void finishOcrSelection(event, payload); });
        pickerIpc.on("ocr-picker:cancel", (event) => { if (!getOcrPickerWindow(event.sender)) return; closeOcrPickerWindows(); sendOcrResult({ cancelled: true }); showMainWindow(); });
        void assertTrusted;
      }
    }
  });
  extractedIpcRegistered = true;
}

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });

  app.whenReady().then(createMainWindow).catch((startupError) => {
    console.error("تعذر تشغيل تطبيق رف الحافظة.", startupError);
    app.exit(1);
  });

  app.on("before-quit", (event) => {
    if (deferQuitUntilFeatureServicesClose(event)) {
      return;
    }

    stopClipboardMonitor();
    void stopKeyboardLockClient();
    stopMarkdownWatcher();
    globalShortcut.unregisterAll();
    closeColorPickerWindows();
    closeOcrPickerWindows();
    void terminateOcrWorker();

    if (tray) {
      tray.destroy();
      tray = null;
    }

    saveWindowPreferences();
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (!mainWindow) {
      void createMainWindow();
    }
  });
}
