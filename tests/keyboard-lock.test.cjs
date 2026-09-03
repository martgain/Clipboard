const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");

const root = path.resolve(__dirname, "..");
const {
  CHANNELS,
  INVOKE_CHANNELS,
  EVENT_CHANNELS,
  validatePayload
} = require("../src/shared/contracts.cjs");

function loadPreloadWithRecorder() {
  const calls = [];
  const listeners = new Map();
  const exposed = {};
  const electronPath = require.resolve("electron");
  const originalElectron = require.cache[electronPath];
  require.cache[electronPath] = {
    exports: {
      contextBridge: { exposeInMainWorld: (_name, bridge) => Object.assign(exposed, bridge) },
      ipcRenderer: {
        invoke: (channel, ...args) => {
          calls.push({ kind: "invoke", channel, args });
          return Promise.resolve();
        },
        send: (channel, ...args) => calls.push({ kind: "send", channel, args }),
        on: (channel, callback) => {
          listeners.set(channel, callback);
          calls.push({ kind: "on", channel });
        }
      }
    }
  };
  delete require.cache[path.join(root, "preload.cjs")];
  require(path.join(root, "preload.cjs"));
  require.cache[electronPath] = originalElectron;
  return { bridge: exposed, calls, listeners };
}

test("keyboard lock IPC validates a boolean and exposes status methods", () => {
  assert.equal(CHANNELS.keyboardLockSet, "keyboard-lock:set");
  assert.equal(CHANNELS.keyboardLockStatus, "keyboard-lock:status");
  assert.equal(CHANNELS.keyboardLockChanged, "keyboard-lock:changed");

  assert.throws(() => validatePayload(CHANNELS.keyboardLockSet, ["true"]), /boolean/i);
  assert.throws(() => validatePayload(CHANNELS.keyboardLockSet, [123]), /boolean/i);
  assert.doesNotThrow(() => validatePayload(CHANNELS.keyboardLockSet, [true]));
  assert.doesNotThrow(() => validatePayload(CHANNELS.keyboardLockSet, [false]));

  assert.ok(INVOKE_CHANNELS.has(CHANNELS.keyboardLockSet));
  assert.ok(INVOKE_CHANNELS.has(CHANNELS.keyboardLockStatus));
  assert.ok(EVENT_CHANNELS.has(CHANNELS.keyboardLockChanged));
});

test("preload exposes keyboard lock methods and rejects invalid arguments", () => {
  const { bridge, calls, listeners } = loadPreloadWithRecorder();

  assert.equal(typeof bridge.setKeyboardLocked, "function");
  assert.equal(typeof bridge.getKeyboardLockStatus, "function");
  assert.equal(typeof bridge.onKeyboardLockChanged, "function");

  assert.throws(() => bridge.setKeyboardLocked("invalid"), /boolean/i);
  assert.throws(() => bridge.setKeyboardLocked(null), /boolean/i);
  assert.throws(() => bridge.onKeyboardLockChanged(null), /function/i);
  assert.throws(() => bridge.onKeyboardLockChanged("not-a-fn"), /function/i);

  bridge.setKeyboardLocked(true);
  assert.deepEqual(calls.at(-1), {
    kind: "invoke",
    channel: "keyboard-lock:set",
    args: [true]
  });

  bridge.getKeyboardLockStatus();
  assert.deepEqual(calls.at(-1), {
    kind: "invoke",
    channel: "keyboard-lock:status",
    args: []
  });

  let notifiedPayload = null;
  bridge.onKeyboardLockChanged((payload) => {
    notifiedPayload = payload;
  });
  assert.ok(listeners.has("keyboard-lock:changed"));
  listeners.get("keyboard-lock:changed")({}, { locked: true });
  assert.deepEqual(notifiedPayload, { locked: true });
});

const fs = require("node:fs");
const childProcess = require("node:child_process");

test("keyboard locker helper script meets Win32 and safety source contracts", () => {
  const helperPath = path.join(root, "native", "windows-bridge", "keyboard-locker.ps1");
  assert.ok(fs.existsSync(helperPath), "keyboard-locker.ps1 must exist");

  const source = fs.readFileSync(helperPath, "utf8");
  assert.match(source, /WH_KEYBOARD_LL/);
  assert.match(source, /SetWindowsHookEx/);
  assert.match(source, /CallNextHookEx/);
  assert.match(source, /Ctrl\+Alt\+Shift\+K/i);
  assert.doesNotMatch(source, /BlockInput/);
});

test("keyboard locker helper protocol responds to set, unlock, and stop via JSONL", async () => {
  if (process.platform !== "win32") {
    return;
  }

  const helperPath = path.join(root, "native", "windows-bridge", "keyboard-locker.ps1");
  assert.ok(fs.existsSync(helperPath), "keyboard-locker.ps1 must exist");

  const child = childProcess.spawn("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperPath
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });

  const lines = [];
  let buffer = "";

  const waitForLine = () => new Promise((resolve, reject) => {
    const check = () => {
      if (lines.length > 0) {
        return resolve(lines.shift());
      }
    };
    check();
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).replace(/\r$/, "");
        buffer = buffer.slice(newlineIdx + 1);
        if (line.trim().length > 0) {
          lines.push(line);
        }
      }
      if (lines.length > 0) {
        child.stdout.removeListener("data", onData);
        resolve(lines.shift());
      }
    };
    child.stdout.on("data", onData);
    child.once("error", reject);
    child.once("exit", (code) => {
      if (lines.length === 0) {
        reject(new Error(`Helper exited prematurely with code ${code}`));
      }
    });
  });

  try {
    const readyLine = await waitForLine();
    const readyEvent = JSON.parse(readyLine);
    assert.deepEqual(readyEvent, { type: "ready", locked: false });

    child.stdin.write(JSON.stringify({ action: "set", locked: true }) + "\n");
    const lockedLine = await waitForLine();
    const lockedEvent = JSON.parse(lockedLine);
    assert.deepEqual(lockedEvent, { type: "state", locked: true });

    child.stdin.write(JSON.stringify({ action: "set", locked: false }) + "\n");
    const unlockedLine = await waitForLine();
    const unlockedEvent = JSON.parse(unlockedLine);
    assert.deepEqual(unlockedEvent, { type: "state", locked: false });

    child.stdin.write(JSON.stringify({ action: "stop" }) + "\n");
    await new Promise((resolve) => {
      child.once("exit", (code) => {
        assert.equal(code, 0);
        resolve();
      });
    });
  } finally {
    if (!child.killed) {
      try {
        child.stdin.end();
        child.kill();
      } catch {}
    }
  }
});

function createFakeChild() {
  const child = new EventEmitter();
  child.stdin = {
    writes: [],
    write(data) {
      this.writes.push(data);
      return true;
    },
    end() {
      this.ended = true;
    }
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    child.killed = true;
  };
  return child;
}

function emitLine(child, payload) {
  child.stdout.emit("data", Buffer.from(`${JSON.stringify(payload)}\n`));
}

test("KeyboardLockClient spawns Windows PowerShell with the resolved helper path and awaits ready", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const child = createFakeChild();
  let spawnCall = null;
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: (command, args, options) => {
      spawnCall = { command, args, options };
      return child;
    }
  });

  const startPromise = client.start();
  emitLine(child, { type: "ready", locked: false });
  const status = await startPromise;

  assert.equal(spawnCall.command, "powershell.exe");
  assert.deepEqual(spawnCall.args, [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    "C:/fake/keyboard-locker.ps1"
  ]);
  assert.equal(spawnCall.options.windowsHide, true);
  assert.deepEqual(status, { mode: "ready", locked: false, reason: null, lastError: null });
});

test("KeyboardLockClient fails safely when the helper never announces ready", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => createFakeChild(),
    startupTimeoutMs: 10
  });

  const status = await client.start();

  assert.equal(status.mode, "error");
  assert.equal(status.locked, false);
  assert.equal(status.reason, "startup-timeout");
});

test("KeyboardLockClient cancels startup timeout when stopped before helper readiness", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const child = createFakeChild();
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => child,
    startupTimeoutMs: 10
  });

  const startPromise = client.start();
  const stopPromise = client.stop();
  child.emit("exit", 0, null);

  const [startStatus, stopStatus] = await Promise.all([startPromise, stopPromise]);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(startStatus.mode, "stopped");
  assert.equal(stopStatus.mode, "stopped");
  assert.equal(client.getStatus().mode, "stopped");
});

test("KeyboardLockClient refuses to start off Windows and reports an unsupported status", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  let spawned = false;
  const client = new KeyboardLockClient({
    platform: "darwin",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => { spawned = true; return createFakeChild(); }
  });

  const status = await client.start();
  assert.equal(spawned, false);
  assert.equal(status.mode, "error");
  assert.equal(status.locked, false);
  assert.equal(status.reason, "unsupported-platform");
});

test("KeyboardLockClient sends validated set commands and resolves once the helper confirms state", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const child = createFakeChild();
  const changes = [];
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => child,
    onStateChange: (status) => changes.push(status)
  });

  const startPromise = client.start();
  emitLine(child, { type: "ready", locked: false });
  await startPromise;

  const setPromise = client.setLocked(true);
  assert.deepEqual(JSON.parse(child.stdin.writes.at(-1)), { action: "set", locked: true });
  emitLine(child, { type: "state", locked: true });
  const applied = await setPromise;

  assert.equal(applied.locked, true);
  assert.equal(applied.mode, "ready");
  assert.ok(changes.some((change) => change.locked === true));

  await assert.rejects(() => client.setLocked("nope"), /boolean/i);
});

test("KeyboardLockClient forwards the emergency-shortcut unlock reason without a pending request", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const child = createFakeChild();
  const changes = [];
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => child,
    onStateChange: (status) => changes.push(status)
  });

  const startPromise = client.start();
  emitLine(child, { type: "ready", locked: false });
  await startPromise;

  emitLine(child, { type: "state", locked: false, reason: "emergency-shortcut" });

  assert.equal(client.getStatus().locked, false);
  assert.ok(changes.some((change) => change.reason === "emergency-shortcut"));
});

test("KeyboardLockClient treats malformed helper output as an error and stays unlocked", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const child = createFakeChild();
  const changes = [];
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => child,
    onStateChange: (status) => changes.push(status)
  });

  const startPromise = client.start();
  emitLine(child, { type: "ready", locked: false });
  await startPromise;

  child.stdout.emit("data", Buffer.from("not-json-at-all\n"));

  const status = client.getStatus();
  assert.equal(status.mode, "error");
  assert.equal(status.locked, false);
  assert.ok(status.lastError);
  assert.ok(changes.some((change) => change.mode === "error"));
});

test("KeyboardLockClient falls back to a safe unlocked error state when the helper exits unexpectedly", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const child = createFakeChild();
  const changes = [];
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => child,
    onStateChange: (status) => changes.push(status)
  });

  const startPromise = client.start();
  emitLine(child, { type: "ready", locked: false });
  await startPromise;

  child.emit("exit", 1, null);

  const status = client.getStatus();
  assert.equal(status.mode, "error");
  assert.equal(status.locked, false);
  assert.equal(status.reason, "helper-exited");
  assert.ok(status.lastError);
  assert.ok(changes.some((change) => change.reason === "helper-exited"));
});

test("KeyboardLockClient reports a hook-install failure from the helper as an error and stays unlocked", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const child = createFakeChild();
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => child
  });

  const startPromise = client.start();
  emitLine(child, { type: "error", code: "HOOK_INSTALL_FAILED", message: "SetWindowsHookEx failed" });
  const status = await startPromise;

  assert.equal(status.mode, "error");
  assert.equal(status.locked, false);
  assert.equal(status.reason, "HOOK_INSTALL_FAILED");
});

test("KeyboardLockClient.stop unlocks, sends stop, and tears down the helper", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  const child = createFakeChild();
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: "C:/fake/keyboard-locker.ps1",
    existsSync: () => true,
    spawn: () => child
  });

  const startPromise = client.start();
  emitLine(child, { type: "ready", locked: false });
  await startPromise;

  const setPromise = client.setLocked(true);
  emitLine(child, { type: "state", locked: true });
  await setPromise;

  const stopPromise = client.stop();
  child.emit("exit", 0, null);
  const status = await stopPromise;

  const writes = child.stdin.writes.map((line) => JSON.parse(line));
  assert.deepEqual(writes.at(-2), { action: "set", locked: false });
  assert.deepEqual(writes.at(-1), { action: "stop" });
  assert.equal(status.mode, "stopped");
  assert.equal(status.locked, false);

  const secondStop = await client.stop();
  assert.equal(secondStop.mode, "stopped");
});

test("KeyboardLockClient reports a helper-not-found status without spawning a process", async () => {
  const { KeyboardLockClient } = require("../src/main/keyboard-lock-client.cjs");
  let spawned = false;
  const client = new KeyboardLockClient({
    platform: "win32",
    helperPath: null,
    existsSync: () => false,
    spawn: () => { spawned = true; return createFakeChild(); }
  });

  const status = await client.start();
  assert.equal(spawned, false);
  assert.equal(status.mode, "error");
  assert.equal(status.reason, "helper-not-found");
  assert.equal(status.locked, false);
});

test("main IPC registration maps validated keyboard lock calls to the client service", () => {
  const { registerIpc } = require("../src/main/ipc/register-ipc.cjs");
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) { handlers.set(channel, handler); },
    on(channel, handler) { handlers.set(channel, handler); }
  };
  const mainWindow = { webContents: {} };
  const calls = [];

  registerIpc({
    mainWindow,
    ipcMain,
    services: {
      setKeyboardLocked: (locked) => {
        calls.push(["set", locked]);
        return { mode: "ready", locked, reason: null, lastError: null };
      },
      getKeyboardLockStatus: () => ({ mode: "ready", locked: false, reason: null, lastError: null })
    }
  });

  const setResult = handlers.get(CHANNELS.keyboardLockSet)({ sender: mainWindow.webContents }, true);
  assert.deepEqual(setResult, { mode: "ready", locked: true, reason: null, lastError: null });
  assert.deepEqual(calls, [["set", true]]);
  assert.throws(() => handlers.get(CHANNELS.keyboardLockSet)({ sender: mainWindow.webContents }, "true"), /boolean/i);

  const statusResult = handlers.get(CHANNELS.keyboardLockStatus)({ sender: mainWindow.webContents });
  assert.deepEqual(statusResult, { mode: "ready", locked: false, reason: null, lastError: null });

  assert.throws(() => handlers.get(CHANNELS.keyboardLockSet)({ sender: {} }, true), /untrusted/i);
});

const fsSync = require("node:fs");

test("main wires the keyboard lock client with resource resolution and shutdown cleanup", () => {
  const mainSource = fsSync.readFileSync(path.join(root, "main.cjs"), "utf8");
  assert.match(mainSource, /KeyboardLockClient/);
  assert.match(mainSource, /keyboard-locker\.ps1/);
  assert.match(mainSource, /resolveKeyboardLockHelperPath/);
  assert.match(mainSource, /keyboardLockClient[?.]*\.stop\(\)/);
  assert.match(mainSource, /CHANNELS\.keyboardLockChanged/);
});
