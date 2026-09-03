const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");

test("main wires the event-driven clipboard client with an adaptive polling fallback", () => {
  assert.match(mainSource, /WindowsListenerClient/);
  assert.match(mainSource, /new WindowsListenerClient\(/);
  assert.match(mainSource, /poll:\s*pollNativeClipboard/);
  assert.match(mainSource, /clipboardListenerClient\.start\(/);
  assert.match(mainSource, /clipboardListenerClient\.stop\(/);
  assert.match(mainSource, /resolveClipboardHelperPath/);
  assert.match(mainSource, /ElectronClipboardAdapter/);
  assert.match(mainSource, /readClipboardSnapshot/);
  assert.match(mainSource, /start\(\(clipboardEvent\) => pollNativeClipboard\(clipboardEvent\)\)/);
});
