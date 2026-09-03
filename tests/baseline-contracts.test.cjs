const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const preloadSource = fs.readFileSync(path.join(projectRoot, "preload.cjs"), "utf8");
const mainSourcePaths = [
  path.join(projectRoot, "main.cjs"),
  path.join(projectRoot, "src", "main", "ipc", "register-ipc.cjs")
];
const mainSource = mainSourcePaths
  .filter((sourcePath) => fs.existsSync(sourcePath))
  .map((sourcePath) => fs.readFileSync(sourcePath, "utf8"))
  .join("\n");
const contractsPath = path.join(projectRoot, "src", "shared", "contracts.cjs");
const extractedContracts = fs.existsSync(contractsPath) ? require(contractsPath) : null;

const expectedBridgeMethods = [
  "loadLibrary", "saveLibrary", "listLibraryBackups", "restoreLibraryBackup",
  "cleanupLibraryMedia", "writeLibraryImage", "readLibraryImage", "deleteLibraryImage",
  "startImageDrag", "openLinkGroup", "readClipboard", "onClipboardChanged", "writeText",
  "writeImage", "minimizeWindow", "closeWindow", "toggleWindowVisibility",
  "setGlobalShortcutEnabled", "setAlwaysOnTop", "getAlwaysOnTop", "startColorPicker",
  "onColorPicked", "startOcrPicker", "onOcrResult", "createLibrarySnapshot",
  "listLibrarySnapshots", "verifyLibrarySnapshot", "restoreLibrarySnapshot",
  "listVersionHistory", "restoreVersionHistory", "rebuildOcrIndex", "writePasteSequence",
  "transformText", "analyzeImage",
  "getLibraryHealth", "getAppHealth", "openMarkdownDirectory", "onLibraryConflict",
  "onQuickPaletteRequested", "setKeyboardLocked", "getKeyboardLockStatus", "onKeyboardLockChanged"
];

const expectedInvokeChannels = [
  "library:load", "library:save", "library:list-backups", "library:restore-backup",
  "library:cleanup-media", "library:write-image", "library:read-image", "library:delete-image",
  "library:create-snapshot", "library:list-snapshots", "library:verify-snapshot",
  "library:restore-snapshot", "library:health", "library:app-health", "library:open-markdown",
  "links:open-group", "clipboard:read", "clipboard:write-text", "clipboard:write-image",
  "clipboard:write-sequence", "clipboard:transform-text", "image:analyze", "ocr:index-rebuild", "library:list-version-history", "library:restore-version-history",
  "window:minimize", "window:close", "window:toggle-visibility", "window:set-global-shortcut",
  "window:set-always-on-top", "window:get-always-on-top", "color-picker:start", "ocr-picker:start",
  "keyboard-lock:set", "keyboard-lock:status"
];

const expectedSendChannels = ["drag:image"];
const expectedPreloadEventChannels = ["clipboard:changed", "color-picker:result", "ocr-picker:result", "library:conflict", "quick-palette:request", "keyboard-lock:changed"];
const expectedMainEventChannels = [
  "clipboard:changed", "color-picker:result", "color-picker:pick", "color-picker:cancel",
  "ocr-picker:result", "ocr-picker:select", "ocr-picker:cancel", "library:conflict", "quick-palette:request",
  "keyboard-lock:changed"
];
const expectedArtifacts = [
  "package.json", "main.cjs", "preload.cjs", "clipboard-shelf.html",
  "library-store.cjs", "markdown-library.cjs", "color-picker.cjs", "ocr-engine.cjs"
];

function extractNames(source, pattern) {
  return [...new Set([...source.matchAll(pattern)].map((match) => match[1]))].sort();
}

test("current bridge methods and IPC channels remain in the baseline contract", () => {
  const actualBridgeMethods = extractNames(preloadSource, /^  ([A-Za-z]\w*)\(/gm);
  const actualPreloadChannels = extractNames(
    preloadSource,
    /ipcRenderer\.(?:invoke|send|on)\("([^"]+)"/g
  );
  const actualMainChannels = extractNames(
    mainSource,
    /(?:ipcMain\.(?:handle|on)|webContents\.send)\("([^"]+)"/g
  );

  assert.deepEqual(actualBridgeMethods, [...expectedBridgeMethods].sort());
  assert.deepEqual(actualPreloadChannels, [...expectedInvokeChannels, ...expectedSendChannels, ...expectedPreloadEventChannels].sort());

  if (extractedContracts) {
    const declaredMainChannels = [...new Set([
      ...extractedContracts.INVOKE_CHANNELS,
      ...extractedContracts.SEND_CHANNELS,
      ...extractedContracts.EVENT_CHANNELS
    ])].sort();
    assert.deepEqual(declaredMainChannels, [...expectedMainEventChannels, ...expectedInvokeChannels, ...expectedSendChannels].sort());
    assert.match(mainSource, /registerIpc\(\{/);
    assert.match(mainSource, /ipcMain\.handle\(channel/);
  } else {
    assert.deepEqual(actualMainChannels, [...expectedMainEventChannels, ...expectedInvokeChannels, ...expectedSendChannels].sort());
  }
});

test("baseline artifacts remain present for verification", () => {
  const verifierPath = path.join(projectRoot, "scripts", "verify-baseline.ps1");
  assert.equal(fs.existsSync(verifierPath), true, "baseline verifier must exist");
  const missingArtifacts = expectedArtifacts.filter((artifactName) => {
    return !fs.existsSync(path.join(projectRoot, artifactName));
  });
  assert.deepEqual(missingArtifacts, []);
});
