const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getOcrResizeSize,
  getOcrRecognitionOptions
} = require("../ocr-preprocess.cjs");

test("upscales small captures for clearer character recognition", () => {
  assert.deepEqual(getOcrResizeSize({ width: 800, height: 400 }), {
    width: 1600,
    height: 800
  });
});

test("caps large captures without changing their aspect ratio", () => {
  assert.deepEqual(getOcrResizeSize({ width: 3000, height: 2000 }), {
    width: 4096,
    height: 2731
  });
});

test("uses sparse page layout for chat bubbles and keeps spaces meaningful", () => {
  assert.deepEqual(getOcrRecognitionOptions(), {
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "0",
    user_defined_dpi: "300"
  });
});
