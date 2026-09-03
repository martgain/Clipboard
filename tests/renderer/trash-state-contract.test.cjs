const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("renderer state preserves smart collections and trash and saves durable trash records", () => {
  const source = readProjectFile("src/renderer/app.js");

  assert.match(source, /smartCollections:\s*\[\]/);
  assert.match(source, /trash:\s*\[\]/);
  assert.match(source, /smartCollections:\s*normalizeSmartCollections\(raw\.smartCollections\)/s);
  assert.match(source, /trash:\s*Array\.isArray\(raw\.trash\)\s*\?\s*\[\.\.\.raw\.trash\]\s*:\s*\[\]/s);
  assert.match(source, /const trashStore = new window\.ClipboardShelfTrash\.TrashStore\(\)/);
  assert.match(source, /trashStore\.hydrate\(Array\.isArray\(nextState\.trash\)\s*\?\s*nextState\.trash\s*:\s*\[\]\)/);
  assert.match(source, /trash:\s*trashStore\.toRecords\(\)/);
  assert.match(source, /libraryLoadResult && libraryLoadResult\.exists \? libraryLoadResult\.library : legacyState/);
});

test("delete and undo flows route snapshots through TrashStore records", () => {
  const source = readProjectFile("src/renderer/app.js");

  assert.match(source, /function deleteEntry\(listName, id\)\s*\{[\s\S]*trashStore\.remove\(\{\s*entry:\s*copyEntry\(deletedEntry\),\s*listName\s*\}\)/);
  assert.match(source, /function clearNormalWithUndo\(\)\s*\{[\s\S]*trashStore\.remove\(\{\s*entry:\s*copyEntry\(entry\),\s*listName:\s*["']normal["']/);
  assert.match(source, /function deleteSelectedEntries\(\)\s*\{[\s\S]*trashStore\.remove\(\{\s*entry:\s*copyEntry\(entry\),\s*listName\s*\}\)/);
  assert.match(source, /setUndoRecord\(\{[\s\S]*recordIds:/);
  assert.match(source, /function undoLastDeletion\(\)\s*\{[\s\S]*lastUndo\.recordIds[\s\S]*trashStore\.restore\(recordId\)/);
  assert.match(source, /restoreDeletedEntry\(restored\.listName,\s*restored\.entry\)/);
});

test("renderer exposes explicit trash helpers and defers image cleanup until purge", () => {
  const source = readProjectFile("src/renderer/app.js");

  assert.match(source, /function restoreTrashRecord\(recordId\)/);
  assert.match(source, /function purgeTrashRecord\(recordId\)/);
  assert.match(source, /function purgeAllTrash\(\)/);
  assert.match(source, /function hasLiveImageReference\(blobKey,\s*ignoredRecordIds\s*=\s*new Set\(\)\)/);
  assert.match(source, /trashStore\.list\(\)\.some\(\(record\)\s*=>/);
  assert.match(source, /function purgeTrashRecord\(recordId\)\s*\{[\s\S]*trashStore\.get\(recordId\)[\s\S]*trashStore\.purge\(recordId\)[\s\S]*if\s*\(blobKey && !hasLiveImageReference\(blobKey,\s*new Set\(\[recordId\]\)\)\)\s*\{[\s\S]*deleteImageBlob\(blobKey\)/);
  assert.match(source, /function purgeAllTrash\(\)\s*\{[\s\S]*trashStore\.list\(\)[\s\S]*trashStore\.purge\(\)[\s\S]*deleteImageBlob\(blobKey\)/);
  assert.doesNotMatch(source, /cleanupImageBlobs\(lastUndo\.entries\)/);
});
