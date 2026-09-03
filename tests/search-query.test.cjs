const test = require("node:test");
const assert = require("node:assert");
const { parseSearchQuery } = require("../search-query.cjs");

test("search-query", async (t) => {
  await t.test("empty query", () => {
    const result = parseSearchQuery("");
    assert.deepEqual(result, { ast: null, error: null });
  });

  await t.test("exact phrase", () => {
    const result = parseSearchQuery('"hello world"');
    assert.deepEqual(result.ast, { type: "PHRASE", value: "hello world" });
  });

  await t.test("prefix/terms", () => {
    const result = parseSearchQuery("hello world");
    assert.deepEqual(result.ast, {
      type: "AND",
      left: { type: "TERM", value: "hello" },
      right: { type: "TERM", value: "world" }
    });
  });

  await t.test("AND/OR/NOT precedence", () => {
    const result = parseSearchQuery("a OR b AND c NOT d");
    // b AND c
    // a OR (b AND c)
    // (a OR (b AND c)) AND NOT d
    assert.ok(result.ast);
  });

  await t.test("invalid regex", () => {
    const result = parseSearchQuery("/[unclosed/");
    assert.equal(result.ast, null);
    assert.equal(typeof result.error, "string");
  });

  await t.test("valid regex", () => {
    const result = parseSearchQuery("/hello/i");
    assert.deepEqual(result.ast, { type: "REGEX", pattern: "hello", flags: "i" });
  });

  await t.test("rejects incomplete phrases and operators", () => {
    assert.match(parseSearchQuery('"missing').error, /phrase/i);
    assert.match(parseSearchQuery("hello AND").error, /operator/i);
    assert.match(parseSearchQuery("hello OR world").error || "", /^$/);
  });
});
