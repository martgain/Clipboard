const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { TrashStore } = require("../src/main/trash-store.cjs");

test("trash store removes a recoverable snapshot without mutating the source entry", () => {
  const entry = {
    id: "entry-1",
    type: "text",
    text: "  exact text\n",
    tags: ["work"],
    createdAt: 10,
    updatedAt: 20
  };
  const store = new TrashStore({ now: () => 100, idFactory: () => "trash-1" });

  const record = store.remove({ entry, listName: "normal" });

  assert.equal(record.id, "trash-1");
  assert.equal(record.originalList, "normal");
  assert.equal(record.deletedAt, 100);
  assert.notStrictEqual(record.entry, entry);
  assert.deepEqual(record.entry, entry);
  assert.deepEqual(entry, {
    id: "entry-1",
    type: "text",
    text: "  exact text\n",
    tags: ["work"],
    createdAt: 10,
    updatedAt: 20
  });
});

test("trash store restores one record and removes it from the bin", () => {
  const entry = { id: "entry-2", type: "text", text: "restore me", tags: [] };
  const store = new TrashStore({ now: () => 200, idFactory: () => "trash-2" });
  const record = store.remove(entry, "pinned");

  const restored = store.restore(record.id);

  assert.equal(restored.id, "entry-2");
  assert.equal(restored.listName, "pinned");
  assert.notStrictEqual(restored.entry, entry);
  assert.deepEqual(restored.entry, entry);
  assert.deepEqual(store.list(), []);
});

test("trash store purges selected records or the whole bin explicitly", () => {
  let nextId = 0;
  const store = new TrashStore({
    now: () => 300,
    idFactory: () => `trash-${++nextId}`
  });
  const first = store.remove({ entry: { id: "a" }, listName: "normal" });
  store.remove({ entry: { id: "b" }, listName: "normal" });

  assert.equal(store.purge(first.id), 1);
  assert.equal(store.list().length, 1);
  assert.equal(store.purge(), 1);
  assert.deepEqual(store.list(), []);
});

test("trash store hydrates and exports exact records with defensive clones", () => {
  const records = [{
    id: "trash-hydrated-text",
    entry: {
      id: "entry-hydrated-text",
      type: "text",
      text: "  أول سطر\nسطر ثانٍ  ",
      tags: ["work"]
    },
    originalList: "normal",
    deletedAt: 400,
    metadata: { source: "test" }
  }, {
    id: "trash-hydrated-image",
    entry: {
      id: "entry-hydrated-image",
      type: "image",
      image: {
        blobKey: "media-key",
        mimeType: "image/png",
        size: 68,
        hash: "hash"
      },
      tags: []
    },
    originalList: "pinned",
    deletedAt: 300
  }];
  const store = new TrashStore({ records });

  records[0].entry.text = "mutated input";
  const exported = store.toRecords();
  exported[0].entry.text = "mutated output";

  assert.equal(store.list()[0].entry.text, "  أول سطر\nسطر ثانٍ  ");
  assert.deepEqual(store.toRecords(), [{
    ...records[0],
    entry: {
      ...records[0].entry,
      text: "  أول سطر\nسطر ثانٍ  "
    }
  }, records[1]]);
});

test("trash store hydrate is atomic and rejects malformed or duplicate records", () => {
  const store = new TrashStore({ records: [{
    id: "existing",
    entry: { id: "entry-existing", type: "text", text: "keep" },
    originalList: "normal",
    deletedAt: 1
  }] });

  assert.throws(() => store.hydrate([
    { id: "duplicate", entry: { id: "entry-a", type: "text", text: "a" }, originalList: "normal", deletedAt: 2 },
    { id: "duplicate", entry: { id: "entry-b", type: "text", text: "b" }, originalList: "normal", deletedAt: 3 }
  ]), /duplicate|invalid/i);
  assert.throws(() => store.hydrate([{ id: "missing-entry", originalList: "normal", deletedAt: 2 }]), /entry|invalid/i);
  assert.deepEqual(store.toRecords(), [{
    id: "existing",
    entry: { id: "entry-existing", type: "text", text: "keep" },
    originalList: "normal",
    deletedAt: 1
  }]);
});

test("shared TrashStore exposes the same API as a browser global", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "shared", "trash-store.js"), "utf8");
  const browserGlobal = {};
  vm.runInNewContext(source, { globalThis: browserGlobal });

  assert.equal(typeof browserGlobal.ClipboardShelfTrash.TrashStore, "function");
  assert.equal(typeof browserGlobal.ClipboardShelfTrash.createTrashStore, "function");
});

test("Node TrashStore adapter re-exports the shared implementation", () => {
  const shared = require("../src/shared/trash-store.js");
  const adapter = require("../src/main/trash-store.cjs");

  assert.strictEqual(adapter.TrashStore, shared.TrashStore);
  assert.strictEqual(adapter.createTrashStore, shared.createTrashStore);
});

test("trash store rejects malformed nested text and image records during hydration", () => {
  const store = new TrashStore();

  assert.throws(() => store.hydrate([{
    id: "bad-text",
    entry: { id: "entry-bad-text", type: "text", text: "   " },
    originalList: "normal",
    deletedAt: 1
  }]), /text|invalid/i);
  assert.throws(() => store.hydrate([{
    id: "bad-image",
    entry: { id: "entry-bad-image", type: "image" },
    originalList: "normal",
    deletedAt: 1
  }]), /image|invalid/i);
});

test("trash store never creates a record with an unsupported original list", () => {
  const store = new TrashStore({ now: () => 1, idFactory: () => "trash-invalid-list" });

  assert.throws(() => store.remove({
    entry: { id: "entry-invalid-list", type: "text", text: "hello" },
    listName: "archive"
  }), /original list|invalid/i);
});
