const assert = require("node:assert/strict");
const test = require("node:test");

const { detectOcrLanguage } = require("../ocr-language.cjs");

test("classifies Arabic letters without treating Arabic-Indic digits as a language", () => {
  assert.equal(detectOcrLanguage("  مرحبًا بالعالم ١٢٣!؟\n"), "ar");
});

test("classifies Latin text without treating ASCII digits or punctuation as English", () => {
  assert.equal(detectOcrLanguage("  Hello, world! 123.\n"), "en");
});

test("reports mixed script text when Arabic and Latin letters are both present", () => {
  assert.equal(detectOcrLanguage("مرحبا Clipboard"), "mixed");
});

test("reports unknown when OCR output has no Arabic or Latin letters", () => {
  assert.equal(detectOcrLanguage(" ١٢٣ — !؟\n\t"), "unknown");
});

test("rejects non-string OCR input at the module boundary", () => {
  assert.throws(() => detectOcrLanguage(null), {
    name: "TypeError",
    message: /OCR text must be a string/i
  });
});
