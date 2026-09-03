const assert = require("node:assert/strict");
const test = require("node:test");

const { SubtitleSession } = require("../src/main/ocr/subtitle-session.cjs");

test("subtitle session emits changed lines in order and deduplicates consecutive repeats", async () => {
  const lines = [];
  const samples = ["السطر 1", "السطر 1", "السطر 2", "السطر 2", "السطر 1"];
  const session = new SubtitleSession({
    capture: async () => Buffer.from("sample"),
    recognize: async () => ({ text: samples.shift(), confidence: 0.9 }),
    onLine: (line) => lines.push(line.text),
    setIntervalFn: () => "timer",
    clearIntervalFn: () => {}
  });

  session.start();
  await session.scan();
  await session.scan();
  await session.scan();
  await session.scan();
  await session.scan();

  assert.deepEqual(lines, ["السطر 1", "السطر 2", "السطر 1"]);
});

test("subtitle session supports pause, resume, stop, and prevents overlapping scans", async () => {
  let releaseCapture;
  const capturePromise = new Promise((resolve) => {
    releaseCapture = resolve;
  });
  let recognizeCalls = 0;
  const session = new SubtitleSession({
    capture: async () => capturePromise,
    recognize: async () => {
      recognizeCalls += 1;
      return { text: "line" };
    }
  });

  assert.equal(session.start(), true);
  assert.equal(session.status, "running");
  const firstScan = session.scan();
  assert.equal(session.scan(), false);
  session.pause();
  assert.equal(session.status, "paused");
  releaseCapture(Buffer.from("sample"));
  await firstScan;
  assert.equal(recognizeCalls, 1);
  assert.equal(await session.scan(), false);
  assert.equal(session.resume(), true);
  assert.equal(session.status, "running");
  session.stop();
  assert.equal(session.status, "stopped");
  assert.equal(session.resume(), false);
});
