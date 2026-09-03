const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { BackupStore } = require("../src/main/storage/backup-store.cjs");
const { MediaStore } = require("../src/main/storage/media-store.cjs");
const { serializeLibraryMarkdown, serializeLinkGroupMarkdown } = require("../markdown-library.cjs");
const { sha256Hex } = require("../src/shared/validation.cjs");

const ONE_PIXEL_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000040001f61738550000000049454e44ae426082", "hex");

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-backup-"));
  const markdownDirectory = path.join(root, "markdown");
  const mediaDirectory = path.join(root, "media");
  const backupDirectory = path.join(root, "backups");
  const mediaStore = new MediaStore({ mediaDirectory });
  const storedImage = mediaStore.write(ONE_PIXEL_PNG, "image/png");
  const library = {
    schemaVersion: 2,
    settings: {
      theme: "dark",
      duplicatePolicy: "dedupe-move-to-top",
      normalLimit: 150,
      autoCapture: true,
      batchSeparator: "<<<CLIPBOARD-ITEM>>>",
      globalShortcutEnabled: false,
      searchQuery: "",
      privacyMode: false,
      retentionDays: 0
    },
    pinned: [{ id: "pin-1", type: "text", text: "pinned", tags: [], createdAt: 1, updatedAt: 1 }],
    normal: [{
      id: "image-1",
      type: "image",
      image: { blobKey: storedImage.mediaKey, mimeType: storedImage.mimeType, size: storedImage.size, hash: storedImage.sha256 },
      tags: [],
      createdAt: 2,
      updatedAt: 2
    }],
    linkGroups: [{ id: "group-1", name: "مجموعة", icon: "link", links: ["https://example.com"], createdAt: 1, updatedAt: 1 }]
  };

  fs.mkdirSync(markdownDirectory, { recursive: true });
  fs.writeFileSync(path.join(markdownDirectory, "library.md"), serializeLibraryMarkdown(library), "utf8");
  return { root, markdownDirectory, mediaDirectory, backupDirectory, library, storedImage };
}

function createTrashOnlyImageFixture() {
  const fixture = createFixture();
  const trashEntry = fixture.library.normal[0];
  fixture.library.normal = [];
  fixture.library.trash = [{
    id: "trash-image-1",
    entry: trashEntry,
    originalList: "normal",
    deletedAt: 3
  }];
  fs.writeFileSync(path.join(fixture.markdownDirectory, "library.md"), serializeLibraryMarkdown(fixture.library), "utf8");
  return fixture;
}

test("backup snapshot verifies and restores text, image bytes, and groups", () => {
  const fixture = createFixture();
  const backupStore = new BackupStore(fixture);

  try {
    const snapshot = backupStore.createSnapshot(fixture.library);
    const verified = backupStore.verifySnapshot(snapshot.path);

    assert.equal(verified.valid, true);
    assert.equal(verified.mediaCount, 1);
    fs.rmSync(path.join(fixture.mediaDirectory, `${fixture.storedImage.mediaKey}.media`), { force: true });

    const restored = backupStore.restore(snapshot.path, "replace");
    assert.equal(restored.restoredItems, 2);
    assert.equal(fs.existsSync(path.join(fixture.mediaDirectory, `${fixture.storedImage.mediaKey}.media`)), true);
    assert.equal(sha256Hex(fs.readFileSync(path.join(fixture.mediaDirectory, `${fixture.storedImage.mediaKey}.media`))), fixture.storedImage.sha256);
    assert.equal(backupStore.verifySnapshot(snapshot.path).valid, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("backup snapshot packages, verifies, and restores a Trash-only image", () => {
  const fixture = createTrashOnlyImageFixture();
  const backupStore = new BackupStore(fixture);

  try {
    const snapshot = backupStore.createSnapshot(fixture.library);
    const mediaPath = path.join(snapshot.path, `attachments/${fixture.storedImage.mediaKey}.media`);
    const verified = backupStore.verifySnapshot(snapshot.path);

    assert.equal(snapshot.mediaCount, 1);
    assert.equal(verified.valid, true);
    assert.deepEqual(verified.manifest.mediaFiles, [`attachments/${fixture.storedImage.mediaKey}.media`]);
    assert.equal(fs.existsSync(mediaPath), true);
    assert.match(
      fs.readFileSync(path.join(snapshot.path, "library.md"), "utf8"),
      new RegExp(`\\"path\\":\\"attachments/${fixture.storedImage.mediaKey}\\.media\\"`)
    );

    fs.rmSync(path.join(fixture.mediaDirectory, `${fixture.storedImage.mediaKey}.media`), { force: true });
    const restored = backupStore.restore(snapshot.path, "replace");

    assert.equal(restored.restoredItems, 1);
    assert.equal(restored.library.trash[0].entry.image.blobKey, fixture.storedImage.mediaKey);
    assert.equal(fs.existsSync(path.join(fixture.mediaDirectory, `${fixture.storedImage.mediaKey}.media`)), true);
    assert.equal(backupStore.verifySnapshot(snapshot.path).valid, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("backup snapshot includes deterministic collection Markdown and portable image references", () => {
  const fixture = createFixture();
  fixture.library.smartCollections = [{
    id: "collection-1",
    title: "Work links",
    kind: "smart",
    query: { text: "release" }
  }];
  const backupStore = new BackupStore(fixture);

  try {
    const snapshot = backupStore.createSnapshot(fixture.library);
    const verified = backupStore.verifySnapshot(snapshot.path);
    const collectionPath = path.join(snapshot.path, "collections", "collection-work-links-collection-1.md");
    const libraryMarkdown = fs.readFileSync(path.join(snapshot.path, "library.md"), "utf8");

    assert.equal(verified.valid, true);
    assert.deepEqual(verified.manifest.collectionFiles, ["collections/collection-work-links-collection-1.md"]);
    assert.equal(fs.existsSync(collectionPath), true);
    assert.match(libraryMarkdown, new RegExp(`\\"path\\":\\"attachments/${fixture.storedImage.mediaKey}\\.media\\"`));

    const restoredCollectionPath = path.join(fixture.markdownDirectory, "collections", "collection-work-links-collection-1.md");
    fs.mkdirSync(path.dirname(restoredCollectionPath), { recursive: true });
    fs.writeFileSync(restoredCollectionPath, "stale", "utf8");
    fs.rmSync(restoredCollectionPath, { force: true });
    backupStore.restore(snapshot.path, "replace");
    assert.equal(fs.existsSync(restoredCollectionPath), true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("backup verification rejects a changed member before restore", () => {
  const fixture = createFixture();
  const backupStore = new BackupStore(fixture);

  try {
    const snapshot = backupStore.createSnapshot(fixture.library);
    fs.appendFileSync(path.join(snapshot.path, "library.md"), "\nchanged\n", "utf8");
    const verified = backupStore.verifySnapshot(snapshot.path);

    assert.equal(verified.valid, false);
    assert.throws(() => backupStore.restore(snapshot.path, "replace"), /verify|integrity|checksum/i);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("backup verification rejects an unsupported format version", () => {
  const fixture = createFixture();
  const backupStore = new BackupStore(fixture);

  try {
    const snapshot = backupStore.createSnapshot(fixture.library);
    const manifestPath = path.join(snapshot.path, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.version = 999;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    assert.equal(backupStore.verifySnapshot(snapshot.path).valid, false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("merge restore preserves separate current Markdown groups and deduplicates incoming content", () => {
  const fixture = createFixture();
  const backupStore = new BackupStore(fixture);
  const currentLibrary = { ...fixture.library, linkGroups: [] };
  const groupsDirectory = path.join(fixture.markdownDirectory, "groups");

  try {
    fs.mkdirSync(groupsDirectory, { recursive: true });
    fs.writeFileSync(path.join(fixture.markdownDirectory, "library.md"), serializeLibraryMarkdown(currentLibrary), "utf8");
    fs.writeFileSync(path.join(groupsDirectory, "current.md"), serializeLinkGroupMarkdown({
      id: "current-group",
      name: "الحالية",
      icon: "folder",
      links: ["https://current.example"],
      createdAt: 1,
      updatedAt: 1
    }), "utf8");

    const snapshot = backupStore.createSnapshot(fixture.library);
    const restored = backupStore.restore(snapshot.path, "merge");
    const groupNames = restored.library.linkGroups.map((group) => group.name).sort();

    assert.deepEqual(groupNames, ["الحالية", "مجموعة"]);
    assert.equal(restored.library.linkGroups.length, 2);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("backup verification rejects undeclared package members", () => {
  const fixture = createFixture();
  const backupStore = new BackupStore(fixture);

  try {
    const snapshot = backupStore.createSnapshot(fixture.library);
    fs.writeFileSync(path.join(snapshot.path, "secret.txt"), "must not be packaged", "utf8");
    assert.equal(backupStore.verifySnapshot(snapshot.path).valid, false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});
