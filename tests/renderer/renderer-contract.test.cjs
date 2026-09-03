const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const rendererRoot = path.join(projectRoot, "src", "renderer");
const rendererModules = [
  "app-state.js",
  "render-library.js",
  "toolbar.js",
  "settings.js",
  "accessibility.js",
  "color-picker.js",
  "save-queue.js",
  "collections.js",
  "quick-palette.js",
  "bulk-actions.js",
  "inspector.js",
  "app.js"
];
const rendererStyles = ["styles/tokens.css", "styles/components.css"];
const overlayAssets = [
  "overlays/color-picker.css",
  "overlays/color-picker.js",
  "overlays/ocr-selection.css",
  "overlays/ocr-selection.js"
];

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

async function importRendererModule(relativePath) {
  const source = fs.readFileSync(path.join(rendererRoot, relativePath), "utf8");
  const encodedSource = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encodedSource}`);
}

function assertStrictLocalCsp(relativePath) {
  const html = readProjectFile(relativePath);
  const cspMeta = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0];
  const csp = cspMeta?.match(/\bcontent="([^"]+)"/i)?.[1];

  assert.ok(csp, `${relativePath} must declare a Content Security Policy`);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|https?:|wss?:/);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
}

test("renderer state store adds, pins, deletes, and searches without changing exact text", async () => {
  const { AppStateStore } = await importRendererModule("app-state.js");
  const originalText = "  أول سطر\nSecond line  ";
  const initialState = {
    settings: { searchQuery: "" },
    pinned: [],
    normal: []
  };
  const entry = Object.freeze({ id: "entry-1", type: "text", text: originalText, tags: [] });
  const store = new AppStateStore(initialState);

  store.dispatch({ type: "entry/add", targetList: "normal", entry });
  assert.equal(store.getState().normal[0].text, originalText);

  store.dispatch({ type: "entry/pin", id: entry.id });
  assert.equal(store.getState().pinned[0].text, originalText);
  assert.equal(store.getState().normal.length, 0);

  store.dispatch({ type: "search/set-query", query: "Second" });
  assert.deepEqual(store.search(), [store.getState().pinned[0]]);
  assert.equal(store.getState().pinned[0].text, originalText);

  store.dispatch({ type: "entry/delete", listName: "pinned", id: entry.id });
  assert.equal(store.getState().pinned.length, 0);
  assert.equal(entry.text, originalText);
  assert.deepEqual(initialState, {
    settings: { searchQuery: "" },
    pinned: [],
    normal: []
  });
});

test("renderer search rejects incomplete syntax and supports normalized Arabic text", async () => {
  const { filterLibraryEntries } = await importRendererModule("app-state.js");
  const entries = [
    { id: "arabic", type: "text", text: "إدارةُ المشاريع", tags: [] },
    { id: "other", type: "text", text: "إدارة المحتوى", tags: [] }
  ];

  assert.deepEqual(filterLibraryEntries(entries, { query: "اداره" }).map((entry) => entry.id), ["arabic", "other"]);
  assert.deepEqual(filterLibraryEntries(entries, { query: '"اداره' }), []);
  assert.deepEqual(filterLibraryEntries(entries, { query: "اداره AND" }), []);
  assert.deepEqual(filterLibraryEntries(entries, { query: "اداره OR مشاريع" }).map((entry) => entry.id), ["arabic", "other"]);
});

test("renderer search applies source and date filters with the text query", async () => {
  const { filterLibraryEntries } = await importRendererModule("app-state.js");
  const entries = [
    {
      id: "recent",
      type: "text",
      text: "release notes",
      tags: [],
      sourceApp: { executable: "chrome.exe" },
      createdAt: Date.parse("2026-09-02T10:00:00Z")
    },
    {
      id: "old",
      type: "text",
      text: "release notes",
      tags: [],
      sourceApp: { executable: "notepad.exe" },
      createdAt: Date.parse("2026-08-01T10:00:00Z")
    }
  ];

  assert.deepEqual(filterLibraryEntries(entries, {
    query: "release",
    source: "chrome.exe",
    dateFrom: "2026-09-01"
  }).map((entry) => entry.id), ["recent"]);
});

test("renderer search includes the whole date selected as dateTo", async () => {
  const { filterLibraryEntries } = await importRendererModule("app-state.js");
  const entries = [
    {
      id: "same-day",
      type: "text",
      text: "release notes",
      tags: [],
      createdAt: Date.parse("2026-09-02T10:00:00Z")
    },
    {
      id: "next-day",
      type: "text",
      text: "release notes",
      tags: [],
      createdAt: Date.parse("2026-09-03T00:00:00Z")
    }
  ];

  assert.deepEqual(filterLibraryEntries(entries, {
    query: "release",
    dateTo: "2026-09-02"
  }).map((entry) => entry.id), ["same-day"]);
});

test("renderer search matches OCR text attached to image entries", async () => {
  const { filterLibraryEntries } = await importRendererModule("app-state.js");
  const entries = [
    { id: "image-with-ocr", type: "image", text: "", ocrText: "نص مستخرج من الصورة", tags: [] },
    { id: "other", type: "image", text: "", ocrText: "نص مختلف", tags: [] }
  ];

  assert.deepEqual(filterLibraryEntries(entries, { query: "مستخرج" }).map((entry) => entry.id), ["image-with-ocr"]);
});

test("renderer regex search scans OCR text attached to image entries", async () => {
  const { filterLibraryEntries } = await importRendererModule("app-state.js");
  const entries = [
    { id: "image-with-ocr", type: "image", text: "", ocrText: "رقم 12345", tags: [] },
    { id: "other", type: "image", text: "", ocrText: "رقم مختلف", tags: [] }
  ];

  assert.deepEqual(filterLibraryEntries(entries, { query: "/12345/" }).map((entry) => entry.id), ["image-with-ocr"]);
});

test("planned renderer modules expose live compatibility surfaces", async () => {
  const [rendering, toolbar, settings, accessibility] = await Promise.all([
    importRendererModule("render-library.js"),
    importRendererModule("toolbar.js"),
    importRendererModule("settings.js"),
    importRendererModule("accessibility.js")
  ]);

  assert.equal(typeof rendering.renderLibrary, "function");
  assert.equal(typeof toolbar.ToolbarController?.prototype.mount, "function");
  assert.equal(typeof settings.wireSettings, "function");
  assert.equal(typeof accessibility.AccessibilityAnnouncer?.prototype.announce, "function");
});

test("Space and Enter activate a focused card through the pointer path and restore focus", async () => {
  const { ToolbarController } = await importRendererModule("toolbar.js");
  const listeners = new Map();
  let clickCount = 0;
  let focusCount = 0;
  const card = {
    dataset: { entryId: "entry-1", listName: "normal" },
    click() { clickCount += 1; },
    focus() { focusCount += 1; }
  };
  const root = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    querySelectorAll() { return [card]; }
  };
  const target = {
    closest(selector) {
      if (selector === ".entry-card") return card;
      if (selector === "button, input, textarea, select, a, [contenteditable=\"true\"]") return null;
      return null;
    }
  };

  new ToolbarController().mount(root);
  const keydown = listeners.get("keydown");

  for (const key of [" ", "Enter"]) {
    let prevented = false;
    keydown({ key, target, preventDefault() { prevented = true; } });
    await Promise.resolve();
    assert.equal(prevented, true);
  }

  assert.equal(clickCount, 2);
  assert.equal(focusCount, 2);
});

test("all three HTML documents use strict local CSP and external assets", () => {
  for (const relativePath of [
    "clipboard-shelf.html",
    "color-picker-overlay.html",
    "ocr-selection-overlay.html"
  ]) {
    assertStrictLocalCsp(relativePath);
  }
});

test("the renderer shell and package include every Task 1 asset", () => {
  const html = readProjectFile("clipboard-shelf.html");
  const appSource = readProjectFile("src/renderer/app.js");
  const packageJson = JSON.parse(readProjectFile("package.json"));
  const packagedFiles = new Set(packageJson.build.files);

  for (const modulePath of rendererModules) {
    assert.ok(packagedFiles.has(`src/renderer/${modulePath}`), `${modulePath} must be packaged`);
  }
  for (const stylePath of rendererStyles) {
    assert.ok(packagedFiles.has(`src/renderer/${stylePath}`), `${stylePath} must be packaged`);
  }
  for (const assetPath of overlayAssets) {
    assert.ok(packagedFiles.has(`src/renderer/${assetPath}`), `${assetPath} must be packaged`);
  }

  assert.match(html, /href="\.\/src\/renderer\/styles\/tokens\.css"/);
  assert.match(html, /href="\.\/src\/renderer\/styles\/components\.css"/);
  assert.match(html, /type="module" src="\.\/src\/renderer\/app\.js"/);
  assert.match(html, /src="\.\/link-group-icons\.js"/);
  assert.match(html, /id="toolsMenuButton"/);
  assert.match(html, /id="toolsMenu"/);
  assert.match(html, /id="toggleSelectionPinsButton"/);
  assert.match(html, /id="deleteSelectionButton"/);
  assert.match(html, /id="inspectorDialog"/);
  assert.match(html, /id="quickPalette"/);
  assert.match(html, /id="quickPaletteInput"/);
  assert.match(appSource, /function setToolsMenu\(open\)/);
  assert.match(appSource, /new QuickPalette/);
  assert.match(appSource, /onQuickPaletteRequested/);
  assert.match(appSource, /import \{ inspectEntry \} from "\.\/inspector\.js"/);

  for (const moduleName of ["app-state", "render-library", "toolbar", "settings", "accessibility", "color-picker", "save-queue"]) {
    assert.match(appSource, new RegExp(`from ["']\\./${moduleName}\\.js["']`));
  }
});
