const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildPasteSequence,
  splitPasteSequence
} = require("../paste-sequence.cjs");

const ENTRIES = [
  { id: "entry-a", type: "text", text: "  first\nline  " },
  { id: "entry-b", type: "text", text: "second\r\nline" },
  { id: "entry-c", type: "text", text: "third" },
  { id: "entry-empty", type: "text", text: "" }
];

test("splitPasteSequence follows the requested stable order and preserves text exactly", () => {
  assert.deepEqual(
    splitPasteSequence(ENTRIES, { order: ["entry-c", "entry-a", "entry-b"] }),
    ["third", "  first\nline  ", "second\r\nline"]
  );
});

test("splitPasteSequence skips empty text without trimming non-empty entries", () => {
  assert.deepEqual(
    splitPasteSequence([
      { id: "empty", text: "" },
      { id: "spaces", text: "  \n  " },
      { id: "text", text: "value" }
    ]),
    ["  \n  ", "value"]
  );
});

test("buildPasteSequence creates one exact derived payload without mutating entries", () => {
  const entries = ENTRIES.map((entry) => ({ ...entry }));
  const snapshot = JSON.parse(JSON.stringify(entries));

  assert.deepEqual(
    buildPasteSequence(entries, {
      separator: "\r\n---\r\n",
      order: ["entry-b", "entry-a", "entry-empty"]
    }),
    {
      text: "second\r\nline\r\n---\r\n  first\nline  ",
      entries: ["second\r\nline", "  first\nline  "],
      separator: "\r\n---\r\n"
    }
  );
  assert.deepEqual(entries, snapshot);
});

test("paste sequence rejects malformed or overlong input bounds", () => {
  assert.throws(() => splitPasteSequence("not-an-array"), /entries/i);
  assert.throws(() => buildPasteSequence([], { separator: "" }), /separator/i);
  assert.throws(() => buildPasteSequence([], { separator: "x".repeat(81) }), /separator/i);
});
