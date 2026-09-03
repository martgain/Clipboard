const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(projectRoot, "clipboard-shelf.html"), "utf8");
const rendererSource = fs.readFileSync(path.join(projectRoot, "src/renderer/app.js"), "utf8");
const componentStyles = fs.readFileSync(path.join(projectRoot, "src/renderer/styles/components.css"), "utf8");
const storeSource = fs.readFileSync(path.join(projectRoot, "library-store.cjs"), "utf8");

test("text expand control shares the card action row", () => {
  assert.match(rendererSource, /if \(expandButton\) \{[\s\S]{0,120}actions\.append\(expandButton\)[\s\S]{0,120}\}/);
  assert.match(rendererSource, /actions\.append\(copyButton, pinButton, tagButton, deleteButton\)/);
  assert.match(componentStyles, /\.expand-toggle\s*\{[\s\S]*display:\s*inline-flex/);
  assert.doesNotMatch(rendererSource, /wrapper\.append\(textBlock, toggleButton\)/);
});

test("normal clipboard capacity is 150 in renderer and Markdown persistence", () => {
  assert.match(rendererSource, /const NORMAL_LIMIT = 150/);
  assert.match(html, /عادية: 0\/150/);
  assert.match(html, /العادية 150 عنصرًا/);
  assert.match(storeSource, /normalLimit: 150/);
  assert.match(storeSource, /settings\.normalLimit === 150/);
});

test("drawer contains semantic smart collections and trash sections with compact one-line UI rules", () => {
  assert.match(html, /<section id="smartCollectionsSection" class="drawer-section" aria-labelledby="smartCollectionsTitle">/);
  assert.match(html, /id="newSmartCollectionButton"/);
  assert.match(html, /id="clearActiveCollectionButton"/);
  assert.match(html, /id="smartCollectionList"/);
  assert.match(html, /id="smartCollectionsEmpty"/);
  assert.match(html, /<section id="trashSection" class="drawer-section" aria-labelledby="trashTitle">/);
  assert.match(html, /id="purgeAllTrashButton"/);
  assert.match(html, /id="trashList"/);
  assert.match(html, /id="trashEmpty"/);

  assert.match(componentStyles, /\.drawer-section\s*\{/);
  assert.match(componentStyles, /\.drawer-section-heading\s*\{/);
  assert.match(componentStyles, /\.drawer-item-preview\s*\{[\s\S]*white-space:\s*nowrap[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis/s);
  assert.match(componentStyles, /\.link-drawer\.is-compact\s+\.drawer-section-title[\s\S]*display:\s*none/s);
  assert.match(componentStyles, /\.link-drawer\.is-compact\s+\.drawer-item-preview[\s\S]*display:\s*none/s);
  assert.match(componentStyles, /\.link-drawer\.is-compact\s+\.drawer-item-meta[\s\S]*display:\s*none/s);
  assert.match(componentStyles, /\.link-drawer\.is-compact\s+\.drawer-row-label[\s\S]*display:\s*none/s);
  assert.match(componentStyles, /\.link-drawer\.is-compact\s+\.drawer-section\s+\.empty-state[\s\S]*display:\s*none/s);
});
