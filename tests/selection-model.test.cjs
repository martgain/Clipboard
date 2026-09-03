const assert = require("node:assert/strict");
const test = require("node:test");

const { updateSelection } = require("../selection-model.cjs");

const ORDERED_IDS = ["a", "b", "c", "d", "e"];

function transition(overrides) {
  return updateSelection({
    selectedIds: [],
    anchorId: null,
    clickedId: "a",
    orderedIds: ORDERED_IDS,
    ctrlKey: false,
    shiftKey: false,
    ...overrides
  });
}

test("plain click selects only the clicked card and sets its anchor", () => {
  assert.deepEqual(
    transition({ selectedIds: ["a", "c"], anchorId: "c", clickedId: "d" }),
    { selectedIds: ["d"], anchorId: "d" }
  );
});

test("Ctrl-click toggles a card while preserving non-contiguous selection order", () => {
  assert.deepEqual(
    transition({ selectedIds: ["c", "a"], anchorId: "a", clickedId: "b", ctrlKey: true }),
    { selectedIds: ["a", "b", "c"], anchorId: "b" }
  );
});

test("Ctrl-click removes an already selected card", () => {
  assert.deepEqual(
    transition({ selectedIds: ["a", "b", "c"], anchorId: "b", clickedId: "b", ctrlKey: true }),
    { selectedIds: ["a", "c"], anchorId: "b" }
  );
});

test("Shift-click selects the inclusive range from the anchor", () => {
  assert.deepEqual(
    transition({ selectedIds: ["b"], anchorId: "b", clickedId: "e", shiftKey: true }),
    { selectedIds: ["b", "c", "d", "e"], anchorId: "b" }
  );
});

test("Shift-click selects the same inclusive range in reverse order", () => {
  assert.deepEqual(
    transition({ selectedIds: ["e"], anchorId: "e", clickedId: "b", shiftKey: true }),
    { selectedIds: ["b", "c", "d", "e"], anchorId: "e" }
  );
});

test("Ctrl+Shift-click extends the existing selection by the inclusive range", () => {
  assert.deepEqual(
    transition({ selectedIds: ["a", "e"], anchorId: "e", clickedId: "c", ctrlKey: true, shiftKey: true }),
    { selectedIds: ["a", "c", "d", "e"], anchorId: "e" }
  );
});
