const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeScreenRect,
  scaleRectToThumbnail,
  hasVisiblePixels
} = require("../ocr-capture.cjs");

test("normalizes a reverse drag and keeps the selection inside the display", () => {
  const selection = normalizeScreenRect(
    { x: 260, y: 180 },
    { x: 80, y: 40 },
    { x: 0, y: 0, width: 300, height: 200 }
  );

  assert.deepEqual(selection, { x: 80, y: 40, width: 180, height: 140 });
});

test("scales a screen selection into a thumbnail and clamps rounding", () => {
  const crop = scaleRectToThumbnail(
    { x: 100, y: 50, width: 200, height: 100 },
    { x: 0, y: 0, width: 800, height: 400 },
    { width: 1600, height: 800 }
  );

  assert.deepEqual(crop, { x: 200, y: 100, width: 400, height: 200 });
});

test("rejects a zero-area selection after normalization", () => {
  assert.throws(
    () => normalizeScreenRect(
      { x: 20, y: 20 },
      { x: 20, y: 20 },
      { x: 0, y: 0, width: 300, height: 200 }
    ),
    /Selection must have positive area/
  );
});

test("detects a protected or unavailable capture that contains only black pixels", () => {
  assert.equal(hasVisiblePixels(Buffer.alloc(16)), false);

  const visiblePixel = Buffer.alloc(16);
  visiblePixel[2] = 255;
  assert.equal(hasVisiblePixels(visiblePixel), true);
});
