const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("renderer wires query-only smart collections through the existing drawer and active filter path", () => {
  const source = readProjectFile("src/renderer/app.js");

  assert.match(source, /import\s*\{\s*createSmartCollection,\s*evaluateCollection,\s*matchesCollectionQuery\s*\}\s*from\s*"\.\/collections\.js"/);
  assert.match(source, /let activeSmartCollectionId = null/);
  assert.match(source, /function createSmartCollectionFromFilters\(\)/);
  assert.match(source, /function applySmartCollection\(collectionId\)/);
  assert.match(source, /function clearActiveSmartCollection\(\)/);
  assert.match(source, /function renameSmartCollection\(collectionId\)/);
  assert.match(source, /function deleteSmartCollection\(collectionId\)/);
  assert.match(source, /function renderSmartCollections\(\)/);
  assert.match(source, /createSmartCollection\(\{[\s\S]*query:\s*currentSmartCollectionDraft\(\)/);
  assert.match(source, /evaluateCollection\(state,\s*collection\.query\)\.length/);
  assert.match(source, /const collectionQuery = currentSmartCollectionQuery\(\)/);
  assert.match(source, /filteredEntries\s*=\s*filteredEntries\.filter\(\(entry\)\s*=>\s*!collectionQuery\s*\|\|\s*matchesCollectionQuery\(entry,\s*collectionQuery\)\)/);
  assert.match(source, /elements\.newSmartCollectionButton\.addEventListener\("click",\s*createSmartCollectionFromFilters\)/);
  assert.match(source, /elements\.clearActiveCollectionButton\.addEventListener\("click",\s*clearActiveSmartCollection\)/);
  assert.doesNotMatch(source, /smartCollections:[\s\S]*items:/);
});

test("renderer exposes trash drawer rows with restore and purge controls and no automatic trash cap", () => {
  const source = readProjectFile("src/renderer/app.js");

  assert.match(source, /function renderTrashRecords\(\)/);
  assert.match(source, /const trashRecords = trashStore\.list\(\)/);
  assert.match(source, /createDrawerButton\("copy",\s*"استعادة",\s*\(\)\s*=>\s*\{[\s\S]*restoreTrashRecord\(record\.id\)/);
  assert.match(source, /createDrawerButton\("trash",\s*"حذف نهائي",\s*\(\)\s*=>\s*\{[\s\S]*purgeTrashRecord\(record\.id\)/);
  assert.match(source, /elements\.purgeAllTrashButton\.addEventListener\("click",\s*\(\)\s*=>\s*\{[\s\S]*purgeAllTrash\(\)/);
  assert.match(source, /renderSmartCollections\(\);[\s\S]*renderLinkGroups\(\);[\s\S]*renderTrashRecords\(\);/);
  assert.doesNotMatch(source, /trashStore\.list\(\)\.slice\(0,\s*\d+\)/);
  assert.doesNotMatch(source, /state\.trash\s*=\s*trashStore\.list\(\)\.slice/);
});
