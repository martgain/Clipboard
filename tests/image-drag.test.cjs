const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createImageDragFile } = require("../image-drag.cjs");

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("image drag file writes a safe PNG file with the original bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-drag-"));

  try {
    const result = createImageDragFile("entry-1", ONE_PIXEL_PNG, root);

    assert.equal(result.extension, ".png");
    assert.equal(result.filePath.startsWith(path.resolve(root)), true);
    assert.deepEqual(fs.readFileSync(result.filePath), Buffer.from(ONE_PIXEL_PNG.split(",")[1], "base64"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("image drag file rejects path traversal and non-image data", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-drag-"));

  try {
    assert.throws(() => createImageDragFile("../escape", ONE_PIXEL_PNG, root), /media key/i);
    assert.throws(() => createImageDragFile("entry-1", "not-an-image", root), /image data/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
