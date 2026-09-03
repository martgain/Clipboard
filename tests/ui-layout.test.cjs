const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const componentStyles = fs.readFileSync(path.join(projectRoot, "src/renderer/styles/components.css"), "utf8");

test("topbar keeps controls in one row with centered square buttons", () => {
  assert.match(componentStyles, /\.topbar\s*\{[\s\S]*?flex-wrap:\s*nowrap;/);
  assert.match(componentStyles, /#settingsButton,[\s\S]*?\.window-btn\s*\{[\s\S]*?display:\s*inline-flex;/);
  assert.match(componentStyles, /#settingsButton,[\s\S]*?\.window-btn\s*\{[\s\S]*?align-items:\s*center;/);
  assert.match(componentStyles, /#settingsButton,[\s\S]*?\.window-btn\s*\{[\s\S]*?justify-content:\s*center;/);
});
