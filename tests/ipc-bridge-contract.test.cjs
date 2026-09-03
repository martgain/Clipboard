const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CHANNELS,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
  validatePayload,
  normalizeGlobalShortcut
} = require("../src/shared/contracts.cjs");
const { registerIpc } = require("../src/main/ipc/register-ipc.cjs");

test("contracts reject unknown channels and malformed path/payload values", () => {
  assert.throws(() => validatePayload("unknown:channel", []), /Unknown IPC channel/);
  assert.throws(() => validatePayload(CHANNELS.libraryReadImage, ["..\\secret"]), /media key|path/i);
  assert.throws(() => validatePayload(CHANNELS.libraryWriteImage, ["..\\secret", "data:image/png;base64,AA=="]), /media key|path/i);
  assert.throws(() => validatePayload(CHANNELS.libraryWriteImage, ["image-key", "not-an-image"]), /image|data/i);
  assert.throws(() => validatePayload(CHANNELS.libraryRestoreBackup, ["../../secret"]), /backup|path/i);
  assert.throws(() => validatePayload(CHANNELS.libraryVerifySnapshot, ["../../secret"]), /backup|path/i);
  assert.throws(() => validatePayload(CHANNELS.libraryRestoreSnapshot, ["snapshot.backup", "invalid"]), /mode|restore/i);
  assert.throws(() => validatePayload(CHANNELS.clipboardWriteImage, ["not-an-image"]), /image/i);
});

test("shared channel metadata separates invoke, send, and renderer-event channels", () => {
  assert.equal(INVOKE_CHANNELS.has(CHANNELS.libraryLoad), true);
  assert.equal(INVOKE_CHANNELS.has(CHANNELS.dragImage), false);
  assert.equal(SEND_CHANNELS.has(CHANNELS.dragImage), true);
  assert.equal(SEND_CHANNELS.has(CHANNELS.ocrPickerSelect), true);
  assert.equal(EVENT_CHANNELS.has(CHANNELS.clipboardChanged), true);
  assert.equal(EVENT_CHANNELS.has(CHANNELS.ocrPickerResult), true);
  assert.equal(EVENT_CHANNELS.has(CHANNELS.libraryConflict), true);
  assert.equal(EVENT_CHANNELS.has(CHANNELS.quickPaletteRequested), true);
  assert.equal(INVOKE_CHANNELS.has(CHANNELS.libraryRestoreSnapshot), true);
});

test("global shortcut contract normalizes supported accelerators and rejects malformed forms", () => {
  assert.equal(normalizeGlobalShortcut(" commandorcontrol + shift + space "), "CommandOrControl+Shift+Space");
  assert.equal(normalizeGlobalShortcut("ctrl+alt+p"), "Ctrl+Alt+P");
  assert.equal(normalizeGlobalShortcut("Ctrl+P"), "Ctrl+P");
  assert.doesNotThrow(() => validatePayload(CHANNELS.windowSetGlobalShortcut, [true, "Ctrl+Shift+P"]));
  assert.throws(() => validatePayload(CHANNELS.windowSetGlobalShortcut, [true, ""]), /shortcut/i);
  assert.throws(() => validatePayload(CHANNELS.windowSetGlobalShortcut, [true, 42]), /shortcut/i);
  assert.throws(() => validatePayload(CHANNELS.windowSetGlobalShortcut, [true, "P"]), /shortcut/i);
  assert.throws(() => validatePayload(CHANNELS.windowSetGlobalShortcut, [true, "Shift+Ctrl"]), /shortcut/i);
  assert.throws(() => validatePayload(CHANNELS.windowSetGlobalShortcut, [true, "Ctrl+Shift+LaunchRocket"]), /shortcut/i);
});

test("IPC registration rejects untrusted senders before services are touched", () => {
  const handlers = new Map();
  const services = new Proxy({}, { get() {
    return () => { throw new Error("service must not be called"); };
  }});
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on(channel, handler) { handlers.set(channel, handler); }
  };
  const mainWindow = { webContents: {} };
  registerIpc({ mainWindow, services, ipcMain });
  assert.throws(() => handlers.get(CHANNELS.libraryLoad)({ sender: {} }), /untrusted/i);
  assert.throws(() => handlers.get(CHANNELS.librarySave)({ sender: {} }, {}), /untrusted/i);
});

test("main has only the extracted IPC registration path", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");
  assert.doesNotMatch(mainSource, /function registerIpcHandlers\s*\(/);
  assert.doesNotMatch(mainSource, /function legacyIpcHandlersDisabled\s*\(/);
  assert.doesNotMatch(mainSource, /ipcMain\.(?:handle|on)\("([^"]+)"/);
  assert.equal((mainSource.match(/registerIpc\(\{/g) || []).length, 1);
});

test("IPC trust follows a recreated main window without registering duplicate handlers", () => {
  const handlers = new Map();
  const firstWindow = { webContents: {} };
  let currentWindow = firstWindow;
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on() {}
  };

  registerIpc({
    getMainWindow: () => currentWindow,
    ipcMain,
    services: new Proxy({ loadLibrary: () => true }, {
      get(target, property) {
        return target[property] || (() => true);
      }
    })
  });

  assert.equal(handlers.get(CHANNELS.libraryLoad)({ sender: firstWindow.webContents }), true);
  currentWindow = { webContents: {} };
  assert.throws(() => handlers.get(CHANNELS.libraryLoad)({ sender: firstWindow.webContents }), /untrusted/i);
  assert.equal(handlers.get(CHANNELS.libraryLoad)({ sender: currentWindow.webContents }), true);
});
