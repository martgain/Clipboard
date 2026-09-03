const assert = require("node:assert/strict");
const test = require("node:test");

const { ShortcutRegistry } = require("../src/main/shortcut-registry.cjs");

test("shortcut registry reports duplicate accelerators and does not register conflicted actions", () => {
  const registrations = [];
  const registry = new ShortcutRegistry({
    defaults: {
      toggleVisibility: "CommandOrControl+Shift+Space",
      quickPalette: "CommandOrControl+P"
    },
    register(shortcut, action) {
      registrations.push({ shortcut, action });
      return true;
    }
  });

  const applicationReport = registry.apply({
    toggleVisibility: "Ctrl+Alt+P",
    quickPalette: "Ctrl+Alt+P",
    pauseCapture: "Ctrl+Alt+L"
  });

  assert.deepEqual(applicationReport.conflicts, [
    { shortcut: "Ctrl+Alt+P", owners: ["toggleVisibility", "quickPalette"] }
  ]);
  assert.deepEqual(applicationReport.applied, { pauseCapture: "Ctrl+Alt+L" });
  assert.deepEqual(registrations, [
    { shortcut: "Ctrl+Alt+L", action: "pauseCapture" }
  ]);
});

test("shortcut registry restores its configurable defaults without mutating the caller mapping", () => {
  const defaults = {
    toggleVisibility: "CommandOrControl+Shift+Space"
  };
  const mapping = { toggleVisibility: "Ctrl+Alt+K" };
  const registry = new ShortcutRegistry({ defaults, register: () => true });

  registry.apply(mapping);
  const restored = registry.restoreDefaults();

  assert.deepEqual(restored.applied, defaults);
  assert.deepEqual(registry.getMapping(), defaults);
  assert.deepEqual(mapping, { toggleVisibility: "Ctrl+Alt+K" });
});

test("shortcut registry exposes the application default when no custom defaults are supplied", () => {
  const registry = new ShortcutRegistry({ register: () => true });

  assert.deepEqual(registry.restoreDefaults().applied, {
    toggleVisibility: "CommandOrControl+Shift+Space"
  });
});

test("shortcut registry excludes an accelerator when the platform registration fails", () => {
  const registry = new ShortcutRegistry({
    defaults: {},
    register(shortcut) {
      return shortcut !== "Ctrl+Alt+X";
    }
  });

  const applicationReport = registry.apply({
    working: "Ctrl+Alt+W",
    unavailable: "Ctrl+Alt+X"
  });

  assert.deepEqual(applicationReport.applied, { working: "Ctrl+Alt+W" });
  assert.deepEqual(applicationReport.unavailable, [
    { action: "unavailable", shortcut: "Ctrl+Alt+X" }
  ]);
});

test("shortcut registry preserves a working shortcut when registering its replacement fails", () => {
  const active = new Set();
  const registry = new ShortcutRegistry({
    defaults: {},
    register(shortcut) {
      if (shortcut === "Ctrl+Alt+X") return false;
      active.add(shortcut);
      return true;
    },
    unregister(shortcut) {
      active.delete(shortcut);
    }
  });

  registry.apply({ toggleVisibility: "Ctrl+Alt+W" });
  const replacement = registry.apply({ toggleVisibility: "Ctrl+Alt+X" });

  assert.deepEqual(replacement.applied, { toggleVisibility: "Ctrl+Alt+W" });
  assert.deepEqual(replacement.unavailable, [{ action: "toggleVisibility", shortcut: "Ctrl+Alt+X" }]);
  assert.deepEqual(registry.getMapping(), { toggleVisibility: "Ctrl+Alt+W" });
  assert.deepEqual([...active], ["Ctrl+Alt+W"]);
});
