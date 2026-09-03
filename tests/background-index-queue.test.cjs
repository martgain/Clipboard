const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { BackgroundIndexQueue } = require("../background-index-queue.cjs");

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-index-queue-"));
}

async function appendEvent(logPath, eventName) {
  await fs.promises.appendFile(logPath, `${eventName}\n`, "utf8");
}

async function readEvents(logPath) {
  const contents = await fs.promises.readFile(logPath, "utf8");
  return contents.trim() ? contents.trim().split("\n") : [];
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test("queue coalesces pending work per key and runs the latest write", async () => {
  const root = makeRoot();
  const logPath = path.join(root, "events.log");

  try {
    const queue = new BackgroundIndexQueue({ concurrency: 2 });
    const queuedPromises = [
      queue.enqueue("entry-1", () => appendEvent(logPath, "stale-1")),
      queue.enqueue("entry-1", () => appendEvent(logPath, "stale-2")),
      queue.enqueue("entry-1", () => appendEvent(logPath, "latest")),
      queue.enqueue("entry-2", () => appendEvent(logPath, "other-key"))
    ];

    await queue.flush();
    await Promise.all(queuedPromises);

    assert.deepEqual((await readEvents(logPath)).sort(), ["latest", "other-key"].sort());
    await queue.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("queue keeps same-key writes ordered while bounding concurrency across keys", async () => {
  const root = makeRoot();
  const logPath = path.join(root, "events.log");
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let activeCount = 0;
  let maximumActive = 0;

  async function runTracked(eventName, releaseGate) {
    activeCount += 1;
    maximumActive = Math.max(maximumActive, activeCount);
    await appendEvent(logPath, `${eventName}-start`);
    if (releaseGate) {
      await releaseGate.promise;
    }
    await appendEvent(logPath, `${eventName}-end`);
    activeCount -= 1;
  }

  try {
    const queue = new BackgroundIndexQueue({ concurrency: 2 });
    const first = queue.enqueue("entry-1", async () => {
      firstStarted.resolve();
      await runTracked("first", releaseFirst);
    });
    await firstStarted.promise;

    const laterSameKey = queue.enqueue("entry-1", () => runTracked("latest", null));
    const otherKey = queue.enqueue("entry-2", () => runTracked("other", null));
    releaseFirst.resolve();

    await queue.flush();
    await Promise.all([first, laterSameKey, otherKey]);

    assert.equal(maximumActive, 2);
    const events = await readEvents(logPath);
    assert.equal(events.includes("stale-start"), false);
    assert.equal(events.indexOf("first-end") < events.indexOf("latest-start"), true);
    await queue.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failed write does not poison a later write for the same key", async () => {
  const root = makeRoot();
  const logPath = path.join(root, "events.log");
  const failedStarted = deferred();

  try {
    const queue = new BackgroundIndexQueue({ concurrency: 1 });
    const failed = queue.enqueue("entry-1", async () => {
      failedStarted.resolve();
      throw new Error("first index failed");
    });
    await failedStarted.promise;

    const recovered = queue.enqueue("entry-1", () => appendEvent(logPath, "recovered"));
    await assert.rejects(failed, /first index failed/);
    await assert.rejects(queue.flush(), /first index failed/);
    await recovered;
    assert.deepEqual(await readEvents(logPath), ["recovered"]);
    await queue.flush();
    await queue.close();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("close flushes queued work and rejects new writes", async () => {
  const root = makeRoot();
  const logPath = path.join(root, "events.log");

  try {
    const queue = new BackgroundIndexQueue({ concurrency: 1 });
    const queued = queue.enqueue("entry-1", () => appendEvent(logPath, "flushed"));
    const closing = queue.close();

    await assert.rejects(queue.enqueue("entry-2", () => appendEvent(logPath, "closed")), /closed/i);
    await closing;
    await queued;
    assert.deepEqual(await readEvents(logPath), ["flushed"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
