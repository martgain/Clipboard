const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { WindowController } = require("../src/main/window-controller.cjs");
const expectedMethods = [
  "loadLibrary", "saveLibrary", "listLibraryBackups", "restoreLibraryBackup",
  "cleanupLibraryMedia", "writeLibraryImage", "readLibraryImage", "deleteLibraryImage",
  "startImageDrag", "openLinkGroup", "readClipboard", "onClipboardChanged", "writeText",
  "writeImage", "minimizeWindow", "closeWindow", "toggleWindowVisibility",
  "setGlobalShortcutEnabled", "setAlwaysOnTop", "getAlwaysOnTop", "startColorPicker",
  "onColorPicked", "startOcrPicker", "onOcrResult", "createLibrarySnapshot",
  "listLibrarySnapshots", "verifyLibrarySnapshot", "restoreLibrarySnapshot",
  "listVersionHistory", "restoreVersionHistory", "rebuildOcrIndex", "writePasteSequence",
  "transformText", "analyzeImage",
  "getLibraryHealth", "getAppHealth", "openMarkdownDirectory", "onLibraryConflict",
  "onQuickPaletteRequested", "setKeyboardLocked", "getKeyboardLockStatus", "onKeyboardLockChanged"
].sort();

function loadPreloadWithRecorder() {
  const calls = [];
  const exposed = {};
  const electronPath = require.resolve("electron");
  const originalElectron = require.cache[electronPath];
  require.cache[electronPath] = { exports: {
    contextBridge: { exposeInMainWorld: (_name, bridge) => Object.assign(exposed, bridge) },
    ipcRenderer: {
      invoke: (channel, ...args) => { calls.push({ kind: "invoke", channel, args }); return Promise.resolve(); },
      send: (channel, ...args) => calls.push({ kind: "send", channel, args }),
      on: () => {}
    }
  }};
  delete require.cache[path.join(root, "preload.cjs")];
  require(path.join(root, "preload.cjs"));
  require.cache[electronPath] = originalElectron;
  return { bridge: exposed, calls };
}

test("Electron bridge retains the complete public method set and validates paths before IPC", () => {
  const { bridge, calls } = loadPreloadWithRecorder();
  assert.deepEqual(Object.keys(bridge).sort(), expectedMethods);
  assert.throws(() => bridge.readLibraryImage("..\\outside.png"), /media key|path/i);
  assert.throws(() => bridge.restoreLibraryBackup("..\\outside.json"), /backup|path/i);
  assert.equal(calls.length, 0);
});

test("global shortcut bridge forwards an optional accelerator for runtime re-registration", () => {
  const { bridge, calls } = loadPreloadWithRecorder();

  bridge.setGlobalShortcutEnabled(true, " ctrl + shift + p ");

  assert.deepEqual(calls, [{
    kind: "invoke",
    channel: "window:set-global-shortcut",
    args: [true, "Ctrl+Shift+P"]
  }]);
});

test("global shortcut bridge rejects modifier-less and unsupported accelerators before IPC", () => {
  const { bridge, calls } = loadPreloadWithRecorder();

  assert.throws(() => bridge.setGlobalShortcutEnabled(true, "P"), /shortcut/i);
  assert.throws(() => bridge.setGlobalShortcutEnabled(true, "Ctrl+Shift+LaunchRocket"), /shortcut/i);
  assert.equal(calls.length, 0);
});

test("main window policy retains Electron security options and denies untrusted navigation/popups", () => {
  const source = fs.readFileSync(path.join(root, "src", "main", "window-controller.cjs"), "utf8");
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /setWindowOpenHandler/);
  assert.match(source, /action:\s*["']deny["']/);
  assert.match(source, /will-navigate/);
});

test("sandboxed preload is self-contained and exposes the desktop bridge", () => {
  const source = fs.readFileSync(path.join(root, "preload.cjs"), "utf8");
  assert.doesNotMatch(source, /require\(\s*["']\.\/src\/shared\/contracts\.cjs["']\s*\)/);
  assert.match(source, /contextBridge\.exposeInMainWorld\("desktopBridge"/);
});

test("window controller exposes the BrowserWindow before loading the renderer", async () => {
  const lifecycle = [];
  let windowOptions;
  class FakeBrowserWindow {
    constructor(options) {
      windowOptions = options;
      this.webContents = {
        setWindowOpenHandler() {},
        on() {},
        once(eventName, callback) {
          lifecycle.push(`once:${eventName}`);
          this.readyCallback = callback;
        }
      };
    }

    setContentSize() {}
    setMenuBarVisibility() {}
    on() {}
    async loadFile() {
      lifecycle.push("load");
      this.webContents.readyCallback?.();
    }
  }

  const controller = new WindowController({
    BrowserWindow: FakeBrowserWindow,
    preloadPath: "preload.cjs",
    rendererPath: "clipboard-shelf.html",
    localRendererUrl: "file:///clipboard-shelf.html",
    preferences: { width: 355, height: 611, alwaysOnTop: true },
    onCreated: () => lifecycle.push("created"),
    onReady: () => lifecycle.push("ready"),
    onResize: () => {},
    onMove: () => {},
    onClosed: () => {}
  });

  await controller.createMain();
  assert.equal(windowOptions.show, true);
  assert.deepEqual(lifecycle, ["created", "once:did-finish-load", "load", "ready"]);
});
