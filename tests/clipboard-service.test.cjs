const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  ClipboardService
} = require("../src/main/clipboard/clipboard-service.cjs");
const {
  ElectronClipboardAdapter,
  UnsupportedClipboardFeatureError
} = require("../src/main/clipboard/electron-clipboard-adapter.cjs");
const {
  WindowsListenerClient
} = require("../src/main/clipboard/windows-listener-client.cjs");

const PNG_BYTES = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.from("task-5-png")
]);

function createClipboardEvent(sequence, payload, extraFields = {}) {
  return {
    sequence,
    capturedAt: "2026-08-31T12:00:00.000Z",
    sourceApp: { executable: "notepad.exe", pid: 42 },
    formats: [payload.kind, ...(extraFields.formats || [])],
    payload,
    ...extraFields
  };
}

test("ClipboardService preserves exact text and drops a repeated sequence", async () => {
  const service = new ClipboardService();
  const text = "  السطر الأول\r\nالسطر الثاني  \n";

  const first = await service.capture(createClipboardEvent(7, { kind: "text", text }));
  const duplicate = await service.capture(createClipboardEvent(7, { kind: "text", text }));

  assert.equal(first.accepted, true);
  assert.equal(first.event.payload.text, text);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.reason, "duplicate-sequence");
});

test("ClipboardService validates image bytes, hash, and size without exposing bytes", async () => {
  const sha256 = crypto.createHash("sha256").update(PNG_BYTES).digest("hex");
  const service = new ClipboardService();

  const acceptedCapture = await service.capture(createClipboardEvent(8, {
    kind: "image",
    mimeType: "image/png",
    bytes: PNG_BYTES,
    sha256,
    size: PNG_BYTES.length
  }));

  assert.equal(acceptedCapture.accepted, true);
  assert.deepEqual(acceptedCapture.event.payload, {
    kind: "image",
    mimeType: "image/png",
    sha256,
    size: PNG_BYTES.length
  });
  assert.equal("bytes" in acceptedCapture.event.payload, false);
  assert.equal(JSON.stringify(acceptedCapture.event).includes(PNG_BYTES.toString("base64")), false);

  await assert.rejects(
    () => service.capture(createClipboardEvent(9, {
      kind: "image",
      mimeType: "image/png",
      bytes: PNG_BYTES,
      sha256,
      size: PNG_BYTES.length + 1
    })),
    /size/i
  );

  await assert.rejects(
    () => service.capture(createClipboardEvent(10, {
      kind: "image",
      mimeType: "image/png",
      bytes: PNG_BYTES,
      sha256: "0".repeat(64),
      size: PNG_BYTES.length
    })),
    /sha|hash/i
  );
});

test("ClipboardService exposes rich-format metadata while stripping rich bytes and paths", async () => {
  const html = "<b>private rich text</b>";
  const rtf = "{\\rtf1\\ansi private rich text}";
  const service = new ClipboardService();

  const acceptedCapture = await service.capture(createClipboardEvent(11, {
    kind: "text",
    text: "canonical text",
    html,
    rtf,
    bookmark: { title: "Example", url: "https://example.test" },
    files: [{ name: "secret.txt", path: "C:\\Users\\private\\secret.txt", size: 12 }]
  }, { formats: ["html", "rtf", "bookmark", "file"] }));

  assert.equal(acceptedCapture.event.payload.text, "canonical text");
  assert.equal("html" in acceptedCapture.event.payload, false);
  assert.equal("rtf" in acceptedCapture.event.payload, false);
  assert.ok(Array.isArray(acceptedCapture.event.richFormats));
  assert.deepEqual(acceptedCapture.event.richFormats.map((format) => format.format), ["html", "rtf", "bookmark", "file"]);
  assert.equal(acceptedCapture.event.richFormats.find((format) => format.format === "html").size, Buffer.byteLength(html));
  assert.equal(acceptedCapture.event.richFormats.find((format) => format.format === "rtf").size, Buffer.byteLength(rtf));
  assert.equal(acceptedCapture.event.richFormats.find((format) => format.format === "file").name, "secret.txt");
  assert.equal(JSON.stringify(acceptedCapture.event).includes(html), false);
  assert.equal(JSON.stringify(acceptedCapture.event).includes("C:\\Users\\private"), false);
});

test("ClipboardService applies source rules and pause/resume without trimming capture decisions", async () => {
  const service = new ClipboardService({
    sourceRules: { block: ["password-manager.exe"] }
  });

  const blocked = await service.capture(createClipboardEvent(20, { kind: "text", text: "blocked" }, {
    sourceApp: { executable: "Password-Manager.exe", pid: 99 }
  }));
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, "source-blocked");

  service.pause();
  const paused = await service.capture(createClipboardEvent(21, { kind: "text", text: "paused" }));
  assert.equal(paused.accepted, false);
  assert.equal(paused.reason, "paused");
  assert.equal(service.isPaused(), true);

  service.resume();
  const resumed = await service.capture(createClipboardEvent(22, { kind: "text", text: "resumed" }));
  assert.equal(resumed.accepted, true);
  assert.equal(resumed.event.payload.text, "resumed");
});

test("ElectronClipboardAdapter propagates read failures and reports missing image APIs honestly", async () => {
  const adapter = new ElectronClipboardAdapter({
    clipboard: {
      readText: async () => { throw new Error("clipboard read failed"); }
    }
  });

  await assert.rejects(() => adapter.readText(), /clipboard read failed/);
  await assert.rejects(() => adapter.readImage(), (error) => {
    assert.equal(error instanceof UnsupportedClipboardFeatureError, true);
    assert.match(error.message, /image/i);
    return true;
  });
});

test("WindowsListenerClient uses helper JSONL events when available", async () => {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => { child.killed = true; };
  const events = [];
  const scheduled = [];
  const client = new WindowsListenerClient({
    platform: "win32",
    helperPath: "C:\\tools\\clipboard-listener.exe",
    existsSync: () => true,
    spawn: () => child,
    setTimeout: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimeout: () => {}
  });

  const status = await client.start((capturedEvent) => events.push(capturedEvent));
  child.stdout.emit("data", Buffer.from('{"sequence":1,"formats":["text"]}\n'));

  assert.equal(status.mode, "helper");
  assert.equal(status.helperSupported, true);
  assert.deepEqual(events, [{ sequence: 1, formats: ["text"] }]);
  assert.equal(scheduled.length, 0);
  client.stop();
  assert.equal(child.killed, true);
});

test("WindowsListenerClient reports unsupported helper and backs off polling adaptively", async () => {
  let pollCount = 0;
  const scheduled = [];
  const events = [];
  const client = new WindowsListenerClient({
    platform: "linux",
    helperPath: "clipboard-listener.exe",
    existsSync: () => false,
    poll: async () => {
      pollCount += 1;
      return pollCount === 1 ? { sequence: 2, formats: ["text"] } : null;
    },
    initialPollIntervalMs: 10,
    maxPollIntervalMs: 40,
    backoffFactor: 2,
    setTimeout: (callback, delay) => { scheduled.push({ callback, delay }); return scheduled.length; },
    clearTimeout: () => {}
  });

  const status = await client.start((capturedEvent) => events.push(capturedEvent));
  assert.equal(status.mode, "polling");
  assert.equal(status.helperSupported, false);
  assert.match(status.reason, /windows|unsupported|helper/i);

  await client.pollOnce();
  await client.pollOnce();

  assert.deepEqual(events, [{ sequence: 2, formats: ["text"] }]);
  assert.deepEqual(scheduled.map((entry) => entry.delay), [10, 20, 40]);
  client.stop();
});
