const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("global shortcut uses the registry and requests the renderer quick palette", () => {
  const mainSource = readProjectFile("main.cjs");
  const preloadSource = readProjectFile("preload.cjs");

  assert.match(mainSource, /ShortcutRegistry/);
  assert.match(mainSource, /setGlobalShortcutEnabled\(enabled, accelerator/);
  assert.match(mainSource, /CHANNELS\.quickPaletteRequested/);
  assert.match(preloadSource, /onQuickPaletteRequested/);
});
