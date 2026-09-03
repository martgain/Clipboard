const assert = require("node:assert/strict");
const test = require("node:test");

const { filterLibraryEntries } = require("../library-filter.cjs");

const entries = [
  { id: "1", type: "text", text: "Hello World", tags: ["Work"] },
  { id: "2", type: "text", text: "رابط المشروع https://example.com", tags: ["روابط"] },
  { id: "3", type: "image", tags: ["Design"] }
];

test("library filter searches text, URLs, tags, and Arabic without mutating order", () => {
  assert.deepEqual(filterLibraryEntries(entries, { query: "EXAMPLE.COM" }).map((entry) => entry.id), ["2"]);
  assert.deepEqual(filterLibraryEntries(entries, { query: "روابط" }).map((entry) => entry.id), ["2"]);
  assert.deepEqual(filterLibraryEntries(entries, { tag: "design" }).map((entry) => entry.id), ["3"]);
  assert.deepEqual(entries.map((entry) => entry.id), ["1", "2", "3"]);
});

test("library filter limits results by type and returns no match when appropriate", () => {
  assert.deepEqual(filterLibraryEntries(entries, { type: "image" }).map((entry) => entry.id), ["3"]);
  assert.deepEqual(filterLibraryEntries(entries, { type: "text", query: "missing" }), []);
});

test("library filter composes source and date filters and rejects malformed queries", () => {
  const datedEntries = [
    { id: "chrome", type: "text", text: "release", sourceApp: { executable: "chrome.exe" }, createdAt: 200 },
    { id: "editor", type: "text", text: "release", sourceApp: { executable: "code.exe" }, createdAt: 100 }
  ];

  assert.deepEqual(filterLibraryEntries(datedEntries, {
    query: "release",
    source: "chrome.exe",
    dateFrom: 150,
    dateTo: 250
  }).map((entry) => entry.id), ["chrome"]);
  assert.deepEqual(filterLibraryEntries(datedEntries, { query: "release AND" }), []);
});

test("library filter includes the whole date selected as dateTo", () => {
  const entriesOnDate = [
    { id: "morning", type: "text", text: "release", createdAt: Date.parse("2026-09-02T10:00:00Z") },
    { id: "next-day", type: "text", text: "release", createdAt: Date.parse("2026-09-03T00:00:00Z") }
  ];

  assert.deepEqual(filterLibraryEntries(entriesOnDate, {
    query: "release",
    dateTo: "2026-09-02"
  }).map((entry) => entry.id), ["morning"]);
});

test("library filter preserves frozen entries while attaching search metadata", () => {
  const frozenEntry = Object.freeze({ id: "frozen", type: "text", text: "Keep this text" });

  const [result] = filterLibraryEntries([frozenEntry], { query: "keep", includeMetadata: true });

  assert.equal(result.id, frozenEntry.id);
  assert.notEqual(result, frozenEntry);
  assert.deepEqual(result.searchRanges, [{ start: 0, end: 4 }]);
  assert.equal(result.searchScore > 0, true);
});
