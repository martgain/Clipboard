const test = require("node:test");
const assert = require("node:assert");
const { normalizeArabicSearch, buildSearchIndex, evaluateSearch } = require("../search-index.cjs");
const { parseSearchQuery } = require("../search-query.cjs");

test("search-index", async (t) => {
  await t.test("normalizeArabicSearch", () => {
    assert.equal(normalizeArabicSearch("أإآا"), "اااا");
    assert.equal(normalizeArabicSearch("يى"), "يي");
    assert.equal(normalizeArabicSearch("ةه"), "هه");
    assert.equal(normalizeArabicSearch("مُحَمَّد"), "محمد");
    // bidi control LRM (U+200E) and RLM (U+200F)
    assert.equal(normalizeArabicSearch("\u200Etest\u200F"), "test");
  });

  await t.test("evaluateSearch exact phrase", () => {
    const entry = { type: "text", text: "hello beautiful world", createdAt: 1000 };
    const query = parseSearchQuery('"beautiful world"').ast;
    const result = evaluateSearch(entry, query);
    assert.ok(result.matched);
    assert.deepEqual(result.ranges, [{ start: 6, end: 21 }]);
  });

  await t.test("evaluateSearch field match tags", () => {
    const entry = { type: "text", text: "hello", tags: ["important"], createdAt: 1000 };
    const query = parseSearchQuery('important').ast;
    const result = evaluateSearch(entry, query);
    assert.ok(result.matched);
    assert.ok(result.score > 0);
  });

  await t.test("evaluateSearch searches OCR text and maps normalized Arabic ranges", () => {
    const ocrEntry = { type: "image", text: "", ocrText: "مُرحبًا بالعالم", createdAt: 1000 };
    const ocrQuery = parseSearchQuery("/بالعالم/").ast;
    assert.equal(evaluateSearch(ocrEntry, ocrQuery).matched, true);

    const arabicEntry = { type: "text", text: "أَنا هنا", createdAt: 1000 };
    const arabicQuery = parseSearchQuery("انا").ast;
    const result = evaluateSearch(arabicEntry, arabicQuery);
    assert.equal(result.matched, true);
    assert.deepEqual(result.ranges, [{ start: 0, end: 4 }]);
  });
});
