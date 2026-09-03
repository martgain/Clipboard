const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAX_ENTRY_NOTE_LENGTH,
  extractLinkMetadata,
  normalizeEntryMetadata
} = require("../entry-metadata.cjs");

test("entry metadata preserves exact text and existing tags", () => {
  assert.equal(typeof normalizeEntryMetadata, "function");

  const entry = {
    id: "entry-1",
    type: "text",
    text: "  exact\ntext  ",
    tags: ["keep-me"],
    note: "  note\nwith spaces  ",
    title: "Read later",
    domain: "example.com"
  };

  const normalized = normalizeEntryMetadata(entry);

  assert.deepEqual(normalized, entry);
});

test("local URL metadata extracts the first HTTP URL without fetching it", () => {
  assert.equal(typeof extractLinkMetadata, "function");

  const originalFetch = global.fetch;
  global.fetch = () => {
    throw new Error("network access is not allowed");
  };

  try {
    assert.deepEqual(
      extractLinkMetadata("Open https://Example.com/docs/start?mode=read"),
      {
        title: null,
        domain: "example.com",
        url: "https://Example.com/docs/start?mode=read"
      }
    );
    assert.deepEqual(extractLinkMetadata("file:///private/secret"), {
      title: null,
      domain: null,
      url: null
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("entry metadata rejects unbounded or unsafe note, title, and domain values", () => {
  assert.equal(typeof normalizeEntryMetadata, "function");

  const baseEntry = { id: "entry-1", type: "text", text: "text", tags: [] };
  const invalidEntries = [
    { ...baseEntry, note: "n".repeat(MAX_ENTRY_NOTE_LENGTH + 1) },
    { ...baseEntry, title: "" },
    { ...baseEntry, title: "bad\u0000title" },
    { ...baseEntry, domain: "https://example.com/path" },
    { ...baseEntry, tags: ["   "] }
  ];

  invalidEntries.forEach((entry) => {
    assert.throws(() => normalizeEntryMetadata(entry), /note|title|domain|tags/i);
  });
});
