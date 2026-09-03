const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { TransformService } = require("../src/main/transform-service.cjs");

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("text transforms preserve the original item and expose explicit output modes", () => {
  const item = {
    id: "entry-1",
    type: "text",
    text: "  أول سطر\n<Second line>  ",
    tags: ["note"]
  };
  const original = structuredClone(item);

  assert.deepEqual(TransformService.toClipboard(item, "plain"), {
    mimeType: "text/plain",
    text: item.text
  });
  assert.equal(TransformService.toClipboard(item, "markdown").text, item.text);
  assert.match(TransformService.toClipboard(item, "html").text, /&lt;Second line&gt;/);
  assert.deepEqual(JSON.parse(TransformService.toClipboard(item, "json").text), item);
  assert.deepEqual(item, original);
});

test("image clipboard and drag transforms keep the original bytes", () => {
  const item = {
    id: "image-1",
    type: "image",
    image: {
      blobKey: "image-1",
      mimeType: "image/png",
      dataUrl: ONE_PIXEL_PNG
    }
  };
  const original = structuredClone(item);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-transform-"));

  try {
    assert.deepEqual(TransformService.toClipboard(item, "image"), {
      mimeType: "image/png",
      dataUrl: ONE_PIXEL_PNG
    });
    const dragResult = TransformService.toDragFile(item, "png", { dragDirectory: root });
    assert.equal(dragResult.extension, ".png");
    assert.deepEqual(fs.readFileSync(dragResult.filePath), Buffer.from(ONE_PIXEL_PNG.split(",")[1], "base64"));
    assert.deepEqual(item, original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("transform service rejects unsupported output modes and missing image bytes", () => {
  assert.throws(() => TransformService.toClipboard({ type: "text", text: "x" }, "rtf"), /unsupported/i);
  assert.throws(() => TransformService.toDragFile({ type: "image", image: {} }, "png", {
    dragDirectory: os.tmpdir()
  }), /data URL/i);
});

test("derived text transforms preserve the source item and expose the applied operation", () => {
  const item = {
    id: "entry-2",
    type: "text",
    text: "  hello world  \r\ndon't stop  ",
    tags: ["note"]
  };
  const original = structuredClone(item);

  const derived = TransformService.toDerivedText(item, "whitespace-cleanup");
  assert.equal(derived.mimeType, "text/plain");
  assert.equal(derived.text, "  hello world\ndon't stop");
  assert.equal(derived.operation, "whitespace-cleanup");
  assert.equal(derived.sourceLength, item.text.length);
  assert.deepEqual(item, original);

  const viaClipboard = TransformService.toClipboard(item, TransformService.DERIVED_TEXT_MODE, {
    operation: "uppercase"
  });
  assert.equal(viaClipboard.text, item.text.toUpperCase());
  assert.deepEqual(item, original);
});

test("derived text transforms reject unsupported operations and non-text items honestly", () => {
  assert.throws(
    () => TransformService.toDerivedText({ type: "text", text: "x" }, "delete-everything"),
    RangeError
  );
  assert.throws(
    () => TransformService.toDerivedText({ type: "image", image: {} }, "uppercase"),
    RangeError
  );
  assert.throws(
    () => TransformService.toClipboard({ type: "text", text: "x" }, TransformService.DERIVED_TEXT_MODE, {
      operation: "not-real"
    }),
    RangeError
  );
});
