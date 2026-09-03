const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { ClipboardAdapter } = require("../src/main/clipboard-adapter.cjs");
const { ElectronClipboardAdapter } = require("../src/main/clipboard/electron-clipboard-adapter.cjs");

class FakeClipboardItem {
  constructor(entries) { this.entries = entries; this.types = Object.keys(entries); }
  getType(type) { return Promise.resolve(this.entries[type]); }
}

test("Electron 44 rich snapshot carries a screenshot when availableFormats is absent", async () => {
  const screenshotBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  const clipboard = {
    read: async () => [new FakeClipboardItem({
      "image/png": new Blob([screenshotBytes], { type: "image/png" })
    })]
  };
  const adapter = new ElectronClipboardAdapter({ clipboard });

  const snapshot = await adapter.readSnapshot();

  assert.equal(snapshot.payload.kind, "image");
  assert.equal(snapshot.payload.mimeType, "image/png");
  assert.deepEqual(snapshot.payload.bytes, screenshotBytes);
});

test("Electron 44 adapter reads and writes text/images through async ClipboardItem APIs", async () => {
  const writes = [];
  const clipboard = {
    read: async () => [new FakeClipboardItem({ "image/png": new Blob([Buffer.from("png-bytes")], { type: "image/png" }) })],
    readText: async () => "clipboard text",
    write: async (items) => writes.push(items),
    writeText: async (text) => writes.push(text)
  };
  const adapter = new ClipboardAdapter({ clipboard, ClipboardItem: FakeClipboardItem, Blob });

  assert.deepEqual(await adapter.readText(), "clipboard text");
  assert.deepEqual(await adapter.readImage(), { mimeType: "image/png", bytes: Buffer.from("png-bytes") });
  await adapter.writeText("written text");
  await adapter.writeImage("data:image/png;base64,aW1hZ2UtYnl0ZXM=");
  assert.equal(writes[0], "written text");
  assert.equal(writes[1][0].types[0], "image/png");
  assert.deepEqual(Buffer.from(await writes[1][0].getType("image/png").then((blob) => blob.arrayBuffer())), Buffer.from("image-bytes"));
});

test("main obtains ClipboardItem from Electron before constructing the adapter", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.cjs"), "utf8");
  assert.match(mainSource, /const \{[^}]*ClipboardItem[^}]*\} = require\("electron"\)/s);
});
