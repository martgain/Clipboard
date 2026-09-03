const assert = require("node:assert/strict");
const test = require("node:test");

const {
  moveCollection,
  validateCollectionTree
} = require("../collection-tree.cjs");

function collection(id, parentId, itemIds = []) {
  return {
    id,
    title: id,
    kind: "manual",
    ...(parentId === undefined ? {} : { parentId }),
    itemIds
  };
}

test("validateCollectionTree normalizes root parents and preserves collection data", () => {
  const collections = [
    collection("work", undefined, ["entry-1"]),
    collection("snippets", "work", ["entry-2"])
  ];

  const normalized = validateCollectionTree(collections);

  assert.deepEqual(normalized, [
    { id: "work", title: "work", kind: "manual", parentId: null, itemIds: ["entry-1"] },
    { id: "snippets", title: "snippets", kind: "manual", parentId: "work", itemIds: ["entry-2"] }
  ]);
  assert.equal(Object.hasOwn(collections[0], "parentId"), false);
  assert.notStrictEqual(normalized[0], collections[0]);
  assert.notStrictEqual(normalized[0].itemIds, collections[0].itemIds);
});

test("validateCollectionTree rejects duplicate IDs, self-parent, unknown parent, and cycles", () => {
  assert.throws(
    () => validateCollectionTree([collection("same"), collection("same")]),
    /duplicate.*id/i
  );
  assert.throws(
    () => validateCollectionTree([collection("same", "same")]),
    /self|cycle/i
  );
  assert.throws(
    () => validateCollectionTree([collection("child", "missing")]),
    /unknown.*parent/i
  );
  assert.throws(
    () => validateCollectionTree([collection("a", "b"), collection("b", "a")]),
    /cycle/i
  );
});

test("moveCollection moves a collection to root with deterministic order and keeps items", () => {
  const collections = [
    collection("work"),
    collection("snippets", "work", ["entry-1"]),
    collection("archive", "work", ["entry-2"])
  ];

  const moved = moveCollection(collections, "snippets", null);

  assert.deepEqual(moved, [
    collection("work", null),
    collection("snippets", null, ["entry-1"]),
    collection("archive", "work", ["entry-2"])
  ]);
  assert.equal(collections[1].parentId, "work");
  assert.notStrictEqual(moved[1], collections[1]);
  assert.notStrictEqual(moved[1].itemIds, collections[1].itemIds);
});

test("moveCollection rejects missing collections and descendant moves", () => {
  const collections = [collection("root"), collection("child", "root"), collection("grandchild", "child")];

  assert.throws(() => moveCollection(collections, "missing", null), /collection.*id/i);
  assert.throws(() => moveCollection(collections, "root", "grandchild"), /cycle|descendant/i);
  assert.throws(() => moveCollection(collections, "child", "missing"), /parent/i);
});

test("collection tree validation applies bounded record and identifier limits", () => {
  assert.throws(() => validateCollectionTree(Array.from({ length: 101 }, (_, index) => collection(`c-${index}`))), /collection/i);
  assert.throws(() => validateCollectionTree([collection("x".repeat(129))]), /id/i);
  assert.throws(() => validateCollectionTree([collection(42)]), /id/i);
});
