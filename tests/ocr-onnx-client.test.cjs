const assert = require("node:assert/strict");
const test = require("node:test");

const {
  normalizeOnnxLineText,
  normalizeOnnxOcrResult
} = require("../src/main/ocr/onnx-ocr-client.cjs");

test("normalizes Arabic visual order and both timestamp formats", () => {
  for (const [rawLine, expectedLine] of [
    ["دير هلتيج 2:32 pm", "جيتله ريد 2:32 pm"],
    ["دير هلتيج 2:32pm", "جيتله ريد 2:32 pm"]
  ]) {
    assert.equal(normalizeOnnxLineText(rawLine), expectedLine);
  }
});

test("keeps OCR line normalization single-line and removes bidi spacing noise", () => {
  assert.equal(
    normalizeOnnxLineText("\u200f  هابخم \t نم\u00a0 علطي   ناشع\n\u200e"),
    "عشان يطلع من مخباه"
  );
});

test("preserves Arabic-Indic digits and Arabic and English symbol order", () => {
  assert.equal(
    normalizeOnnxLineText("١٢٣؟ @ # + = / - _ !, مقر ،مالسلا"),
    "السلام، رقم ١٢٣؟ @ # + = / - _ !,"
  );
});

test("does not reorder a symbols-and-digits-only OCR line", () => {
  assert.equal(
    normalizeOnnxLineText("١٢٣٫٤٥٪ ؛ ؟ ، ! ? : @ # + ="),
    "١٢٣٫٤٥٪ ؛ ؟ ، ! ? : @ # + ="
  );
});

test("preserves logical Arabic word order and meaningful spaces", () => {
  assert.equal(
    normalizeOnnxLineText("هابخم نم علطي ناشع"),
    "عشان يطلع من مخباه"
  );
});

test("converts PaddleOCR nested boxes into ordered text lines", () => {
  const result = normalizeOnnxOcrResult([
    [
      [[[10, 80], [100, 80], [100, 100], [10, 100]], ["هابخم نم علطي ناشع", 0.91]],
      [[[10, 10], [80, 10], [80, 30], [10, 30]], ["Ahmed Allam", 0.98]],
      [[[100, 10], [155, 10], [155, 30], [100, 30]], ["2:32 pm", 0.99]]
    ]
  ]);

  assert.equal(result.text, "Ahmed Allam 2:32 pm\nعشان يطلع من مخباه");
  assert.equal(result.lines.length, 2);
  assert.equal(result.confidence, 0.96);
});
