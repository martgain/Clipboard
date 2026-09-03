const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractOcrTextFromBlocks,
  normalizeOcrText,
  orderOcrLines
} = require("../ocr-text.cjs");

test("trims OCR padding while preserving meaningful line breaks", () => {
  assert.equal(normalizeOcrText("  Hello  \nArabic text\n\n "), "Hello\nArabic text");
});

test("returns an empty string for whitespace-only OCR output", () => {
  assert.equal(normalizeOcrText(" \n\t "), "");
});

test("removes bidi controls and collapses OCR spacing without losing line breaks", () => {
  assert.equal(
    normalizeOcrText("  مرحبا\u200f   بالعالم  \n\tSecond   line "),
    "مرحبا بالعالم\nSecond line"
  );
});

test("rebuilds OCR text from block lines in reading order", () => {
  const blocks = [
    {
      paragraphs: [{
        lines: [
          { text: "السطر الأول\n", bbox: { x0: 200, y0: 20 } },
          { text: "السطر الثاني\n", bbox: { x0: 200, y0: 50 } }
        ]
      }]
    }
  ];

  assert.equal(extractOcrTextFromBlocks(blocks), "السطر الأول\nالسطر الثاني");
});

test("keeps adjacent Arabic message text before its right-side timestamp", () => {
  const blocks = [
    {
      paragraphs: [{
        lines: [
          { text: "5:40 pm", bbox: { x0: 123, y0: 28, x1: 170, y1: 41 } },
          { text: "السلام عليكم", bbox: { x0: 56, y0: 17, x1: 116, y1: 30 } }
        ]
      }]
    }
  ];

  assert.equal(extractOcrTextFromBlocks(blocks), "السلام عليكم 5:40 pm");
});

test("joins adjacent OCR fragments that share the same visual row", () => {
  const blocks = [
    {
      paragraphs: [{
        lines: [
          { text: "@all ردي", bbox: { x0: 10, y0: 58, x1: 90, y1: 74 } },
          { text: "حضراتكم", bbox: { x0: 94, y0: 59, x1: 160, y1: 75 } }
        ]
      }]
    }
  ];

  assert.equal(extractOcrTextFromBlocks(blocks), "@all ردي حضراتكم");
});

test("does not merge stacked lines when one OCR box is unusually tall", () => {
  const blocks = [
    {
      paragraphs: [{
        lines: [
          { text: "السطر الأول", bbox: { x0: 10, y0: 10, x1: 120, y1: 35 } },
          { text: "السطر الثاني", bbox: { x0: 10, y0: 36, x1: 160, y1: 77 } }
        ]
      }]
    }
  ];

  assert.equal(extractOcrTextFromBlocks(blocks), "السطر الأول\nالسطر الثاني");
});

test("does not duplicate a timestamp already present in a visual row", () => {
  const blocks = [
    {
      paragraphs: [{
        lines: [
          { text: "النص 2:32 pm", bbox: { x0: 10, y0: 10, x1: 150, y1: 35 } },
          { text: "2:32 pm", bbox: { x0: 155, y0: 12, x1: 205, y1: 32 } }
        ]
      }]
    }
  ];

  assert.equal(extractOcrTextFromBlocks(blocks), "النص 2:32 pm");
});

test("orders OCR lines from top to bottom before rebuilding the text", () => {
  const lines = orderOcrLines([
    { text: "second", bbox: { x0: 0, y0: 120 } },
    { text: "first", bbox: { x0: 0, y0: 20 } }
  ]);

  assert.deepEqual(lines.map((line) => line.text), ["first", "second"]);
});
