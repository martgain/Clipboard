const assert = require("node:assert/strict");
const test = require("node:test");

const { parseFrontmatter, serializeFrontmatter } = require("../markdown-frontmatter.cjs");

test("fixed typed frontmatter round-trips metadata and preserves the body", () => {
  assert.equal(typeof serializeFrontmatter, "function");
  assert.equal(typeof parseFrontmatter, "function");

  const body = "# رف الحافظة\n\n<!-- clipboard-shelf:format {\"version\":1} -->\n";
  const source = serializeFrontmatter({
    format: "clipboard-shelf",
    version: 1,
    kind: "library",
    id: "library-1",
    title: "رف الحافظة"
  }) + body;

  const parsed = parseFrontmatter(source);

  assert.deepEqual(parsed.metadata, {
    format: "clipboard-shelf",
    version: 1,
    kind: "library",
    id: "library-1",
    title: "رف الحافظة"
  });
  assert.equal(parsed.body, body);
});

test("frontmatter ignores unknown keys but rejects malformed allowed values", () => {
  assert.equal(typeof parseFrontmatter, "function");

  const parsed = parseFrontmatter("---\nformat: clipboard-shelf\nversion: 1\nunknown: ignored\n---\n# body\n");
  assert.deepEqual(parsed.metadata, { format: "clipboard-shelf", version: 1 });
  assert.throws(() => parseFrontmatter("---\nversion: not-a-number\n---\n# body\n"), /version|frontmatter/i);
  assert.throws(() => parseFrontmatter("---\nformat: clipboard-shelf\nversion: 1\nversion: 1\n---\n# body\n"), /duplicated|frontmatter/i);
  assert.throws(() => parseFrontmatter("---\nkind: library\n---\n# body\n"), /missing|frontmatter/i);
});

test("marker-only Markdown remains readable through the frontmatter boundary", () => {
  assert.equal(typeof parseFrontmatter, "function");

  const legacy = "# رف الحافظة\n<!-- clipboard-shelf:format {\"version\":1} -->\n";
  assert.deepEqual(parseFrontmatter(legacy), { metadata: {}, body: legacy });
});
