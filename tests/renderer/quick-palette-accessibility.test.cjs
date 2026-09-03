const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

async function importRendererModule(relativePath) {
  const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

test("quick palette accessibility contract gives every result a stable active-descendant option id", async () => {
  const { quickPaletteOptionId, quickPaletteActiveDescendant } = await importRendererModule("src/renderer/quick-palette-accessibility.js");

  assert.equal(quickPaletteOptionId({ id: "entry 1" }, 0), "quick-palette-option-entry-1");
  assert.equal(quickPaletteOptionId({ id: "entry 1" }, 7), "quick-palette-option-entry-1");
  assert.equal(quickPaletteActiveDescendant([{ id: "first" }, { id: "second" }], 1), "quick-palette-option-second");
  assert.equal(quickPaletteActiveDescendant([], 0), "");
});

test("quick palette accessibility contract restores focus to its invoking control", async () => {
  const { restoreQuickPaletteFocus } = await importRendererModule("src/renderer/quick-palette-accessibility.js");
  const calls = [];
  const invokingControl = { isConnected: true, focus: (options) => calls.push(options) };

  restoreQuickPaletteFocus(invokingControl);

  assert.deepEqual(calls, [{ preventScroll: true }]);
  assert.equal(restoreQuickPaletteFocus({ isConnected: false, focus() {} }), false);
});

test("quick palette renderer wires the search input to its active option and scrolls it into view", async () => {
  const html = fs.readFileSync(path.join(projectRoot, "clipboard-shelf.html"), "utf8");
  const { syncQuickPaletteAccessibility } = await importRendererModule("src/renderer/quick-palette-accessibility.js");
  const attributes = new Map();
  const scrollCalls = [];
  const activeOption = { scrollIntoView: (options) => scrollCalls.push(options) };
  const input = { setAttribute: (name, value) => attributes.set(name, value) };
  const listbox = { querySelector: (selector) => selector === "#quick-palette-option-second" ? activeOption : null };

  assert.match(html, /id="quickPaletteInput"[^>]*aria-controls="quickPaletteList"/);
  assert.equal(syncQuickPaletteAccessibility(input, listbox, [{ id: "first" }, { id: "second" }], 1), "quick-palette-option-second");
  assert.equal(attributes.get("aria-activedescendant"), "quick-palette-option-second");
  assert.deepEqual(scrollCalls, [{ block: "nearest" }]);
  assert.doesNotThrow(() => syncQuickPaletteAccessibility(input, { querySelector() { throw new Error("must not query an empty id"); } }, [], 0));
});
