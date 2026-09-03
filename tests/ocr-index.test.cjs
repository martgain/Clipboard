const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { OcrIndex } = require("../src/main/ocr/ocr-index.cjs");

test("OCR index stores searchable text separately from image bytes", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-ocr-index-"));
  const filePath = path.join(root, "ocr-index.json");

  try {
    const index = new OcrIndex({ filePath });
    await index.upsert({ entryId: "image-1", text: "زر الموقع افتح هنا", language: "ar-SA", confidence: 0.88 });
    await index.upsert({ entryId: "image-2", text: "Open the settings panel", language: "en-US", confidence: 0.95 });

    assert.deepEqual(index.search("الموقع").map((item) => item.entryId), ["image-1"]);
    assert.deepEqual(index.search("SETTINGS").map((item) => item.entryId), ["image-2"]);
    assert.equal(fs.readFileSync(filePath, "utf8").includes("data:image"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("OCR index rebuild replaces stale entries and rejects empty queries", async () => {
  const index = new OcrIndex();
  await index.upsert({ entryId: "old", text: "old text" });
  const result = await index.rebuild([
    { entryId: "new", text: "new text" },
    { entryId: "new-2", text: "another text" }
  ]);

  assert.equal(result.count, 2);
  assert.deepEqual(index.search("old"), []);
  assert.equal(index.search("new").length, 1);
  assert.deepEqual(index.search("   "), []);
});

test("OCR index can persist through a bounded background queue", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-ocr-queue-"));
  const filePath = path.join(root, "ocr-index.json");
  const calls = [];
  const queue = {
    enqueue(key, work) {
      calls.push(key);
      return work();
    }
  };

  try {
    const index = new OcrIndex({ filePath, persistQueue: queue });
    await index.upsert({ entryId: "queued", text: "queued OCR" });
    assert.deepEqual(calls, ["ocr-index"]);
    assert.deepEqual(new OcrIndex({ filePath }).search("queued"), []);
    const reloaded = new OcrIndex({ filePath });
    await reloaded.ensureLoaded();
    assert.equal(reloaded.search("queued").length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
