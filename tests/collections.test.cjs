const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

async function importRendererModule(relativePath) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const encodedSource = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encodedSource}`);
}

test("smart collection queries match current entries by text, type, tags, source, and date", async () => {
  const { CollectionQuery } = await importRendererModule("src/renderer/collections.js");
  const matchingEntry = {
    id: "entry-1",
    type: "text",
    text: "  Release checklist  ",
    tags: ["Work", "Release"],
    sourceApp: "Code.exe",
    capturedAt: "2026-08-30T10:00:00.000Z"
  };
  const otherEntry = {
    id: "entry-2",
    type: "text",
    text: "Release notes",
    tags: ["Personal"],
    sourceApp: "Notepad.exe",
    capturedAt: "2026-08-29T10:00:00.000Z"
  };
  const imageEntry = {
    id: "entry-3",
    type: "image",
    tags: ["Work", "Release"],
    source: { app: "Code.exe" },
    createdAt: 1788084000000
  };
  const state = {
    pinned: [matchingEntry],
    normal: [otherEntry, imageEntry]
  };

  const matchingEntries = CollectionQuery.evaluate(state, {
    text: "CHECKLIST",
    type: "text",
    tags: ["work", "release"],
    sourceApps: ["code.exe"],
    dateFrom: "2026-08-30T00:00:00.000Z",
    dateTo: "2026-08-31T00:00:00.000Z"
  });

  assert.equal(matchingEntries.length, 1);
  assert.strictEqual(matchingEntries[0], matchingEntry);
});

test("smart collections store only a query and reevaluate against changed state without copying entries", async () => {
  const { CollectionQuery, createSmartCollection } = await importRendererModule("src/renderer/collections.js");
  const first = { id: "entry-1", type: "text", text: "alpha", tags: ["saved"] };
  const second = { id: "entry-2", type: "text", text: "beta", tags: ["saved"] };
  const collection = createSmartCollection({
    id: "collection-1",
    title: "Saved",
    query: { tags: ["saved"] }
  });
  const state = { pinned: [], normal: [first] };

  assert.deepEqual(collection, {
    id: "collection-1",
    title: "Saved",
    kind: "smart",
    query: { tags: ["saved"] }
  });
  assert.equal("items" in collection, false);
  assert.strictEqual(CollectionQuery.evaluate(state, collection.query)[0], first);

  state.normal.push(second);
  const reevaluated = CollectionQuery.evaluate(state, collection.query);
  assert.deepEqual(reevaluated.map((entry) => entry.id), ["entry-1", "entry-2"]);
  assert.strictEqual(reevaluated[1], second);
});
