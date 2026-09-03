const assert = require("node:assert/strict");
const test = require("node:test");

const {
  joinClipboardBatch,
  splitClipboardBatch
} = require("../clipboard-batch.cjs");

const SEPARATOR = "<<<CLIPBOARD-ITEM>>>";

test("split returns one unchanged item when no separator line exists", () => {
  const text = "plain <<<CLIPBOARD-ITEM>>> text";

  assert.deepEqual(splitClipboardBatch(text, SEPARATOR), [text]);
});

test("split separates multiple complete separator lines", () => {
  const text = "one\n<<<CLIPBOARD-ITEM>>>\ntwo\n<<<CLIPBOARD-ITEM>>>\nthree";

  assert.deepEqual(splitClipboardBatch(text, SEPARATOR), ["one", "two", "three"]);
});

test("split handles CRLF separator lines without changing item content", () => {
  const text = "first\r\n<<<CLIPBOARD-ITEM>>>\r\nsecond\r\n<<<CLIPBOARD-ITEM>>>\r\nthird";

  assert.deepEqual(splitClipboardBatch(text, SEPARATOR), ["first", "second", "third"]);
});

test("split ignores empty segments from adjacent or boundary separators", () => {
  const text = "<<<CLIPBOARD-ITEM>>>\n<<<CLIPBOARD-ITEM>>>\nlast\n<<<CLIPBOARD-ITEM>>>";

  assert.deepEqual(splitClipboardBatch(text, SEPARATOR), ["last"]);
});

test("split preserves spaces and non-separator newlines", () => {
  const text = "  first  \nline\n<<<CLIPBOARD-ITEM>>>\n\n  second  \n";

  assert.deepEqual(splitClipboardBatch(text, SEPARATOR), ["  first  \nline", "\n  second  \n"]);
});

test("join ignores empty text and places the separator on a complete line", () => {
  assert.equal(
    joinClipboardBatch(["first", "", " second "], SEPARATOR),
    "first\n<<<CLIPBOARD-ITEM>>>\n second "
  );
});

test("join returns empty text when every item is empty", () => {
  assert.equal(joinClipboardBatch(["", ""], SEPARATOR), "");
});
