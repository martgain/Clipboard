const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLibraryStore } = require("../library-store.cjs");
const { assertPersistableLibrary, MAX_NORMAL_ENTRIES } = require("../src/shared/validation.cjs");

function makeEntry(id, updatedAt = 1) {
  return { id, type: "text", text: "text-" + id, tags: [], createdAt: updatedAt, updatedAt };
}

function makeLibrary() {
  return {
    schemaVersion: 2,
    settings: {
      theme: "light",
      duplicatePolicy: "dedupe-move-to-top",
      normalLimit: 150,
      autoCapture: true,
      batchSeparator: "<<<CLIPBOARD-ITEM>>>",
      globalShortcutEnabled: false,
      searchQuery: "",
      privacyMode: false,
      retentionDays: 0
    },
    pinned: [],
    normal: []
  };
}

const ONE_PIXEL_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000040001f61738550000000049454e44ae426082", "hex");

test("shared validation enforces 150 normal entries while Pins remain unlimited", () => {
  const library = makeLibrary();
  library.pinned = Array.from({ length: 200 }, (_, index) => makeEntry("pin-" + index));
  library.normal = Array.from({ length: MAX_NORMAL_ENTRIES }, (_, index) => makeEntry("normal-" + index));

  assert.doesNotThrow(() => assertPersistableLibrary(library));
  library.normal.push(makeEntry("normal-over-limit"));
  assert.throws(() => assertPersistableLibrary(library), /150|normal/i);
});

test("shared validation rejects duplicate IDs and invalid timestamps", () => {
  const duplicateLibrary = makeLibrary();
  duplicateLibrary.pinned = [makeEntry("same-id")];
  duplicateLibrary.normal = [makeEntry("same-id")];
  assert.throws(() => assertPersistableLibrary(duplicateLibrary), /duplicate|id/i);

  const invalidTimestampLibrary = makeLibrary();
  invalidTimestampLibrary.normal = [makeEntry("bad-time", -1)];
  assert.throws(() => assertPersistableLibrary(invalidTimestampLibrary), /createdAt|timestamp|time/i);
});

test("library-store rejects an over-capacity normal list before writing Markdown", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-constraints-"));
  const store = createLibraryStore({
    dataFile: path.join(root, "library.json"),
    markdownDirectory: path.join(root, "markdown"),
    mediaDirectory: path.join(root, "media")
  });

  try {
    const library = makeLibrary();
    library.normal = Array.from({ length: MAX_NORMAL_ENTRIES + 1 }, (_, index) => makeEntry("normal-" + index));
    assert.throws(() => store.save(library), /150|normal/i);
    assert.equal(fs.existsSync(path.join(root, "markdown", "library.md")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library-store writes a transaction generation before exposing the Markdown facade", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-transaction-facade-"));
  const store = createLibraryStore({
    dataFile: path.join(root, "library.json"),
    markdownDirectory: path.join(root, "markdown"),
    mediaDirectory: path.join(root, "media")
  });

  try {
    const library = store.load();
    store.save({ ...library, normal: [makeEntry("transaction-entry")] });
    const transactionRoot = path.join(root, "markdown", ".transactions");
    const currentPath = path.join(transactionRoot, "current.json");

    assert.equal(fs.existsSync(currentPath), true);
    assert.equal(store.load().normal[0].id, "transaction-entry");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library-store keeps legacy image metadata compatible while enforcing image data validation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-image-facade-"));
  const store = createLibraryStore({
    dataFile: path.join(root, "library.json"),
    markdownDirectory: path.join(root, "markdown"),
    mediaDirectory: path.join(root, "media")
  });

  try {
    const dataUrl = `data:image/png;base64,${ONE_PIXEL_PNG.toString("base64")}`;
    const library = makeLibrary();
    const entry = {
      id: "image-entry",
      type: "image",
      image: { blobKey: "legacy-image-key", mimeType: "image/png", size: ONE_PIXEL_PNG.length, hash: "deadbeef" },
      tags: [],
      createdAt: 1,
      updatedAt: 1
    };

    store.writeImage(entry.image.blobKey, dataUrl);
    library.normal = [entry];

    assert.doesNotThrow(() => store.save(library));
    assert.match(store.readImage(entry.image.blobKey), /^data:image\/png;base64,/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
