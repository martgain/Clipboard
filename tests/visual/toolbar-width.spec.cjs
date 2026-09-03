const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");
const componentStyles = fs.readFileSync(path.join(projectRoot, "src/renderer/styles/components.css"), "utf8");
const mainSource = fs.readFileSync(path.join(projectRoot, "src/main/window-controller.cjs"), "utf8");
const appSource = fs.readFileSync(path.join(projectRoot, "src/renderer/app.js"), "utf8");

async function importRendererModule(relativePath) {
  const source = fs.readFileSync(path.join(projectRoot, "src/renderer", relativePath), "utf8");
  const encodedSource = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encodedSource}`);
}

test("adaptive toolbar keeps the minimum window usable at 210px", async () => {
  const { ToolbarController } = await importRendererModule("toolbar.js");
  const classNames = new Set();
  const listeners = new Map();
  const root = {
    clientWidth: 355,
    classList: {
      toggle(name, enabled) {
        if (enabled) classNames.add(name);
        else classNames.delete(name);
      }
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    }
  };

  const toolbar = new ToolbarController();
  toolbar.mount(root);
  toolbar.setDensity(210);

  assert.equal(classNames.has("density-compact"), true);
  assert.equal(classNames.has("density-tight"), true);
  assert.equal(typeof listeners.get("keydown"), "function");
  assert.match(componentStyles, /\.density-tight[\s\S]*#settingsButton/);
  assert.match(componentStyles, /\.density-tight #colorPickerButton/);
  assert.match(componentStyles, /\.density-tight #toolsMenuButton/);
  assert.match(mainSource, /minWidth:\s*210,\s*minHeight:\s*260/);
});

test("incremental renderer contract is present and keyed reconciliation is wired", async () => {
  const { renderLibrary } = await importRendererModule("render-library.js");
  assert.equal(typeof renderLibrary.incremental, "function");
  assert.match(appSource, /renderLibrary\.incremental\(state,\s*renderList\)/);
  assert.match(appSource, /renderedCardCache/);
});
