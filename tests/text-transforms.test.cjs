const assert = require("node:assert/strict");
const test = require("node:test");

const {
  transformText,
  transformPreview,
  isSupportedOperation,
  SUPPORTED_OPERATIONS
} = require("../text-transforms.cjs");

test("whitespace-cleanup normalizes line endings and trims trailing spaces", () => {
  const source = "First line  \r\nSecond\tline \r\n   \r\nThird line";
  const result = transformText(source, "whitespace-cleanup");

  assert.equal(result.text, "First line\nSecond\tline\n\nThird line");
  assert.equal(result.operation, "whitespace-cleanup");
  assert.equal(result.sourceLength, source.length);
});

test("whitespace-cleanup preserves indentation and only collapses spaces on request", () => {
  const source = "  indented    words   here";

  const untouched = transformText(source, "whitespace-cleanup");
  assert.equal(untouched.text, "  indented    words   here");

  const collapsed = transformText(source, "whitespace-cleanup", { collapseSpaces: true });
  assert.equal(collapsed.text, "  indented words here");
});

test("whitespace-only lines become empty instead of keeping trailing whitespace", () => {
  const result = transformText("a\n   \t \nb", "whitespace-cleanup");
  assert.equal(result.text, "a\n\nb");
});

test("case conversion is Arabic-safe and only affects Latin case-bearing characters", () => {
  const source = "hello أهلاً world 123";

  const upper = transformText(source, "uppercase");
  assert.equal(upper.text, "HELLO أهلاً WORLD 123");

  const lower = transformText(source.toUpperCase(), "lowercase");
  assert.equal(lower.text, source.toUpperCase().toLowerCase());

  const arabicOnly = "مرحبا بالعالم";
  assert.equal(transformText(arabicOnly, "uppercase").text, arabicOnly);
  assert.equal(transformText(arabicOnly, "lowercase").text, arabicOnly);
});

test("quotes-straighten converts curly/smart quotes to straight ASCII quotes", () => {
  const source = "“Hello” and ‘world’ don’t stop";
  const result = transformText(source, "quotes-straighten");
  assert.equal(result.text, "\"Hello\" and 'world' don't stop");
});

test("quotes-smart converts straight quotes to contextual curly quotes", () => {
  const result = transformText("\"Hello\" and 'world' don't stop", "quotes-smart");
  assert.equal(result.text, "“Hello” and ‘world’ don’t stop");
});

test("bullets-to-numbered renumbers each contiguous bullet block from one", () => {
  const source = "- first\n* second\n• third\nnot a list\n- fourth\n- fifth";
  const result = transformText(source, "bullets-to-numbered");
  assert.equal(result.text, "1. first\n2. second\n3. third\nnot a list\n1. fourth\n2. fifth");
});

test("bullets-to-numbered preserves indentation", () => {
  const result = transformText("  - nested item", "bullets-to-numbered");
  assert.equal(result.text, "  1. nested item");
});

test("numbered-to-bullets converts numbered markers back to bullets", () => {
  const source = "1. first\n2) second\nplain line\n1. third";
  const result = transformText(source, "numbered-to-bullets");
  assert.equal(result.text, "- first\n- second\nplain line\n- third");
});

test("empty input is a safe no-op for every supported operation", () => {
  for (const operation of SUPPORTED_OPERATIONS) {
    const result = transformText("", operation);
    assert.equal(result.text, "");
    assert.equal(result.sourceLength, 0);
  }
});

test("transformText rejects operations outside the bounded allow-list", () => {
  assert.throws(() => transformText("text", "delete-everything"), RangeError);
  assert.throws(() => transformText("text", "__proto__"), RangeError);
  assert.equal(isSupportedOperation("uppercase"), true);
  assert.equal(isSupportedOperation("delete-everything"), false);
});

test("transformText rejects non-string input", () => {
  assert.throws(() => transformText(null, "uppercase"), TypeError);
});

test("transformPreview is read-only and reports whether the text changed", () => {
  const source = "Hello world";
  const unchanged = transformPreview(source, "uppercase");
  assert.deepEqual(unchanged, { before: source, after: "HELLO WORLD", changed: true });
  assert.equal(source, "Hello world");

  const noop = transformPreview("ALREADY UPPER", "uppercase");
  assert.equal(noop.changed, false);
  assert.equal(noop.before, "ALREADY UPPER");
  assert.equal(noop.after, "ALREADY UPPER");
});

test("transformPreview bounds long text with a truncated ellipsis", () => {
  const source = "a".repeat(5000);
  const preview = transformPreview(source, "uppercase", { previewLength: 10 });
  assert.equal(preview.before, `${"a".repeat(10)}…`);
  assert.equal(preview.after, `${"A".repeat(10)}…`);
  assert.equal(preview.changed, true);
});

test("transformPreview treats null options as an empty options object", () => {
  assert.deepEqual(transformPreview("Hello", "uppercase", null), {
    before: "Hello",
    after: "HELLO",
    changed: true
  });
});
