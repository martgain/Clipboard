const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { updateSelection } = require("../../selection-model.cjs");

const projectRoot = path.resolve(__dirname, "../..");

async function importRendererModule(relativePath) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  const encodedSource = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encodedSource}`);
}

test("selection actions preserve Ctrl non-contiguous and Shift range keyboard selection semantics", () => {
  const orderedIds = ["a", "b", "c", "d"];

  assert.deepEqual(updateSelection({
    selectedIds: ["a", "c"],
    anchorId: "c",
    clickedId: "b",
    orderedIds,
    ctrlKey: true,
    shiftKey: false
  }), { selectedIds: ["a", "b", "c"], anchorId: "b" });

  assert.deepEqual(updateSelection({
    selectedIds: ["b"],
    anchorId: "b",
    clickedId: "d",
    orderedIds,
    ctrlKey: false,
    shiftKey: true
  }), { selectedIds: ["b", "c", "d"], anchorId: "b" });
});

test("bulk actions update selected entries atomically and provide one undo transaction", async () => {
  const { applyBulkAction } = await importRendererModule("src/renderer/bulk-actions.js");
  const first = { id: "a", type: "text", text: "first", tags: [] };
  const second = { id: "b", type: "text", text: "second", tags: [] };
  const originalState = {
    settings: { normalLimit: 150 },
    pinned: [],
    normal: [first, second]
  };

  const bulkApplication = applyBulkAction(originalState, ["a", "b"], {
    type: "tag",
    tag: "urgent"
  });

  assert.deepEqual(bulkApplication.nextState.normal.map((entry) => entry.tags), [["urgent"], ["urgent"]]);
  assert.deepEqual(first.tags, []);
  assert.deepEqual(second.tags, []);
  assert.strictEqual(bulkApplication.undo(), originalState);
  assert.strictEqual(bulkApplication.transaction.undo(), originalState);
});

test("quick palette copies the selected item without mutating it or triggering synthetic paste", async () => {
  const { QuickPalette } = await importRendererModule("src/renderer/quick-palette.js");
  const entry = {
    id: "entry-1",
    type: "text",
    text: "  full\ntext  ",
    tags: []
  };
  const copied = [];
  let pasted = 0;
  const palette = new QuickPalette({
    copy(item) {
      copied.push(item);
    },
    paste() {
      pasted += 1;
    }
  });

  const openState = palette.open([entry]);
  assert.equal(openState.open, true);
  assert.strictEqual(openState.items[0], entry);

  const activation = await palette.handleKey("Enter");

  assert.strictEqual(activation.item, entry);
  assert.strictEqual(copied[0], entry);
  assert.equal(pasted, 0);
  assert.equal(palette.getState().open, false);
  assert.equal(entry.text, "  full\ntext  ");
});

test("quick palette preserves image payload fidelity when it copies an image entry", async () => {
  const { QuickPalette } = await importRendererModule("src/renderer/quick-palette.js");
  const entry = { id: "image-1", type: "image", image: { blobKey: "asset.png", mimeType: "image/png" }, mediaKey: "asset.png" };
  const copied = [];
  const palette = new QuickPalette({ copy: (item, payload) => copied.push({ item, payload }) });

  palette.open([entry]);
  const activation = await palette.activate();

  assert.strictEqual(copied[0].item, entry);
  assert.deepEqual(copied[0].payload, { type: "image", image: entry.image, mediaKey: "asset.png" });
  assert.deepEqual(activation.payload, { type: "image", image: entry.image, mediaKey: "asset.png" });
});

test("quick palette remains open after copy failure", async () => {
  const { QuickPalette } = await importRendererModule("src/renderer/quick-palette.js");
  const palette = new QuickPalette({ copy: () => { throw new Error("clipboard unavailable"); } });

  palette.open([{ id: "entry-1", type: "text", text: "keep open" }]);
  const activation = await palette.activate();

  assert.equal(activation.copied, false);
  assert.match(activation.error.message, /clipboard unavailable/);
  assert.equal(palette.getState().open, true);
});

test("quick palette filters pinned and normal entries and click selection activates the clicked result", async () => {
  const { QuickPalette } = await importRendererModule("src/renderer/quick-palette.js");
  const pinned = { id: "pinned-1", type: "text", text: "Pinned note", tags: ["urgent"] };
  const normal = { id: "normal-1", type: "text", text: "Normal note", tags: ["later"] };
  const copied = [];
  const palette = new QuickPalette({ copy: (item) => copied.push(item) });

  palette.open([pinned, normal]);
  palette.setQuery("note");
  assert.deepEqual(palette.getState().items, [pinned, normal]);
  palette.setQuery("urgent");
  assert.deepEqual(palette.getState().items, [pinned]);
  palette.setQuery("note");
  const activation = await palette.activate(1);

  assert.strictEqual(activation.item, normal);
  assert.strictEqual(copied[0], normal);
});

test("inspector exposes read-only content and redacts sensitive metadata", async () => {
  const { inspectEntry } = await importRendererModule("src/renderer/inspector.js");
  const entry = {
    id: "entry-1",
    type: "text",
    text: "private exact text",
    tags: ["work"],
    capturedAt: "2026-08-30T10:00:00.000Z",
    sourceApp: "Code.exe",
    metadata: {
      token: "do-not-show",
      windowTitle: "Visible context"
    }
  };

  const inspectorModel = inspectEntry(entry, { listMemberships: ["normal"] });

  assert.equal(inspectorModel.type, "text");
  assert.equal(inspectorModel.content, entry.text);
  assert.equal(inspectorModel.source, "Code.exe");
  assert.deepEqual(inspectorModel.tags, ["work"]);
  assert.deepEqual(inspectorModel.listMemberships, ["normal"]);
  assert.equal(inspectorModel.metadata.token, "[REDACTED]");
  assert.equal(inspectorModel.metadata.windowTitle, "Visible context");
  assert.equal(Object.isFrozen(inspectorModel), true);
  assert.equal(Object.isFrozen(inspectorModel.metadata), true);
  assert.deepEqual(entry.metadata, {
    token: "do-not-show",
    windowTitle: "Visible context"
  });
});
