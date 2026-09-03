const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MarkdownWatcher } = require("../src/main/storage/markdown-watcher.cjs");

function waitForChange() {
  return new Promise((resolve) => setTimeout(resolve, 180));
}

test("MarkdownWatcher reports an external edit as a conflict after debounce", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-watcher-"));
  const markdownFile = path.join(root, "library.md");
  const changes = [];
  fs.writeFileSync(markdownFile, "# initial\n", "utf8");
  const watcher = new MarkdownWatcher({
    markdownFile,
    debounceMs: 20,
    onConflict: (change) => changes.push(change)
  });

  try {
    watcher.start();
    fs.writeFileSync(markdownFile, "# external\n", "utf8");
    await waitForChange();

    assert.equal(changes.length, 1);
    assert.equal(changes[0].conflict, true);
    assert.deepEqual(changes[0].paths, [markdownFile]);
  } finally {
    watcher.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MarkdownWatcher stop prevents a queued callback", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-watcher-stop-"));
  const markdownFile = path.join(root, "library.md");
  let callbackCount = 0;
  fs.writeFileSync(markdownFile, "# initial\n", "utf8");
  const watcher = new MarkdownWatcher({
    markdownFile,
    debounceMs: 20,
    onConflict: () => { callbackCount += 1; }
  });

  try {
    watcher.start();
    fs.writeFileSync(markdownFile, "# external\n", "utf8");
    watcher.stop();
    await waitForChange();
    assert.equal(callbackCount, 0);
  } finally {
    watcher.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
