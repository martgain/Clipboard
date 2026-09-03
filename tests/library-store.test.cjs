const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createLibraryStore } = require("../library-store.cjs");
const { serializeLibrarySnapshotMarkdown, serializeLinkGroupMarkdown } = require("../markdown-library.cjs");

const ONE_PIXEL_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-store-"));
  return {
    root,
    store: createLibraryStore({
      dataFile: path.join(root, "library.json"),
      mediaDirectory: path.join(root, "media"),
      backupDirectory: path.join(root, "backups"),
      backupIntervalMs: 0
    })
  };
}

test("library store loads defaults and round-trips link groups", () => {
  const { root, store } = makeStore();

  try {
    const defaults = store.load();
    assert.equal(defaults.schemaVersion, 2);
    assert.deepEqual(defaults.smartCollections, []);
    assert.deepEqual(defaults.trash, []);
    assert.deepEqual(defaults.linkGroups, []);

    const library = {
      ...defaults,
      linkGroups: [{
        id: "group-1",
        name: "شغلي",
        icon: "briefcase",
        links: ["https://example.com"],
        createdAt: 1,
        updatedAt: 1
      }]
    };

    store.save(library);
    assert.deepEqual(store.load(), library);
    assert.equal(fs.existsSync(path.join(root, "markdown", "library.md")), true);
    assert.equal(fs.readdirSync(path.join(root, "markdown", "groups")).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store exposes safe version history and restores through the Markdown save path", () => {
  const { root, store } = makeStore();

  try {
    const defaults = store.load();
    store.save({ ...defaults, normal: [{ id: "history-first", type: "text", text: "first", tags: [], createdAt: 1, updatedAt: 1 }] });
    store.save({ ...defaults, normal: [{ id: "history-second", type: "text", text: "second", tags: [], createdAt: 2, updatedAt: 2 }] });

    const history = store.listVersionHistory();
    assert.equal(history.length >= 2, true);
    assert.equal(history.every((item) => !Object.hasOwn(item, "state")), true);

    const restored = store.restoreVersionHistory(history[1].id);
    assert.equal(restored.sourceGeneration, history[1].id);
    assert.equal(store.load().normal[0].text, "first");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store round-trips generic saved lists without changing item text", () => {
  const { root, store } = makeStore();

  try {
    const library = store.load();
    const saved = {
      ...library,
      linkGroups: [{
        id: "group-text",
        name: "ملاحظات",
        icon: "book",
        items: ["سطر أول\nسطر ثان", "  نص بمسافات  "],
        createdAt: 1,
        updatedAt: 1
      }]
    };

    store.save(saved);
    assert.deepEqual(store.load().linkGroups, saved.linkGroups);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store gives legacy link groups the default icon and preserves valid icons", () => {
  const { root, store } = makeStore();

  try {
    const defaults = store.load();
    store.save({
      ...defaults,
      linkGroups: [
        { id: "legacy", name: "قديم", links: ["https://example.com"], createdAt: 1, updatedAt: 1 },
        { id: "custom", name: "مخصص", icon: "globe", links: ["https://example.org"], createdAt: 1, updatedAt: 1 },
        { id: "invalid", name: "غير صالح", icon: "unknown", links: ["https://example.net"], createdAt: 1, updatedAt: 1 }
      ]
    });

    const groups = store.load().linkGroups;
    assert.equal(groups.find((group) => group.id === "legacy").icon, "link");
    assert.equal(groups.find((group) => group.id === "custom").icon, "globe");
    assert.equal(groups.find((group) => group.id === "invalid").icon, "link");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store persists and removes image media by opaque key", () => {
  const { root, store } = makeStore();

  try {
    store.writeImage("entry-1", ONE_PIXEL_PNG);
    assert.equal(store.readImage("entry-1"), ONE_PIXEL_PNG);
    store.deleteImage("entry-1");
    assert.equal(store.readImage("entry-1"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store writes content-addressed media and reads it through the existing facade", () => {
  const { root, store } = makeStore();

  try {
    const stored = store.writeImage("entry-1", ONE_PIXEL_PNG);

    assert.match(stored.mediaKey, /^[a-f0-9]{64}$/);
    assert.equal(stored.mediaKey, stored.sha256);
    assert.equal(store.readImage(stored.mediaKey), ONE_PIXEL_PNG);
    assert.equal(fs.existsSync(path.join(root, "media", `${stored.mediaKey}.media`)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store migrates a legacy image sidecar to content-addressed media without deleting the source first", () => {
  const { root, store } = makeStore();
  const library = store.load();
  const legacyKey = "legacy-image";

  try {
    store.writeImage(legacyKey, ONE_PIXEL_PNG);
    fs.readdirSync(path.join(root, "media"))
      .filter((name) => name.endsWith(".media"))
      .forEach((name) => fs.rmSync(path.join(root, "media", name), { force: true }));
    library.normal = [{
      id: "legacy-image-entry",
      type: "image",
      image: { blobKey: legacyKey, mimeType: "image/png", size: 68, hash: "deadbeef" },
      tags: [],
      createdAt: 1,
      updatedAt: 1
    }];
    store.save(library);

    const migrated = store.load();
    const migratedKey = migrated.normal[0].image.blobKey;
    assert.match(migratedKey, /^[a-f0-9]{64}$/);
    assert.equal(store.readImage(migratedKey), ONE_PIXEL_PNG);
    assert.equal(fs.existsSync(path.join(root, "media", `${legacyKey}.dataurl`)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store rejects malformed image data and keeps media inside its directory", () => {
  const { root, store } = makeStore();

  try {
    assert.throws(() => store.writeImage("../outside", ONE_PIXEL_PNG), /media key/i);
    assert.throws(() => store.writeImage("entry-1", "not-an-image"), /image data/i);
    assert.throws(() => store.writeImage("entry-2", "data:image/png;base64,bm90LXBuZw=="), /magic|MIME|match/i);
    assert.equal(fs.existsSync(path.join(root, "outside")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store treats malformed persisted state as recoverable data, not an existing library", () => {
  const { root, store } = makeStore();
  const dataFile = path.join(root, "library.json");

  try {
    fs.writeFileSync(dataFile, JSON.stringify({ schemaVersion: 1, normal: [] }), "utf8");
    assert.equal(store.load().schemaVersion, 2);
    assert.equal(store.hasData(), false);
    assert.equal(fs.readdirSync(root).some((name) => name.includes("recovery-")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store quarantines only a malformed group file and keeps the library readable", () => {
  const { root, store } = makeStore();
  const markdownDirectory = path.join(root, "markdown");
  const groupsDirectory = path.join(markdownDirectory, "groups");

  try {
    const library = store.load();
    fs.mkdirSync(groupsDirectory, { recursive: true });
    fs.writeFileSync(path.join(markdownDirectory, "library.md"), serializeLibrarySnapshotMarkdown(library), "utf8");
    fs.writeFileSync(path.join(groupsDirectory, "broken.md"), "# not a clipboard shelf group\n", "utf8");

    const loaded = store.load();
    assert.equal(loaded.schemaVersion, 2);
    assert.deepEqual(loaded.linkGroups, []);
    assert.equal(fs.existsSync(path.join(groupsDirectory, "broken.md")), false);
    assert.equal(fs.readdirSync(groupsDirectory).some((name) => name.includes("recovery-")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store preserves an existing group file that is not in the current library payload", () => {
  const { root, store } = makeStore();
  const markdownDirectory = path.join(root, "markdown");
  const groupsDirectory = path.join(markdownDirectory, "groups");
  const groupPath = path.join(groupsDirectory, "external.md");

  try {
    const library = store.load();
    fs.mkdirSync(groupsDirectory, { recursive: true });
    fs.writeFileSync(groupPath, serializeLinkGroupMarkdown({
      id: "external-group",
      name: "External",
      links: ["https://external.example"],
      createdAt: 1,
      updatedAt: 1
    }), "utf8");

    store.save(library);

    assert.equal(fs.existsSync(groupPath), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store writes deterministic Markdown files for smart collections", () => {
  const { root, store } = makeStore();
  const collection = {
    id: "collection-1",
    title: "Work links",
    kind: "smart",
    query: { text: "release" }
  };

  try {
    store.save({ ...store.load(), smartCollections: [collection] });
    const collectionPath = path.join(root, "markdown", "collections", "collection-work-links-collection-1.md");

    assert.equal(fs.existsSync(collectionPath), true);
    assert.match(fs.readFileSync(collectionPath, "utf8"), /clipboard-shelf:collection/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store quarantines one broken collection file while retaining valid collection files", () => {
  const { root, store } = makeStore();
  const markdownDirectory = path.join(root, "markdown");
  const collectionsDirectory = path.join(markdownDirectory, "collections");
  const validPath = path.join(collectionsDirectory, "valid.md");
  const brokenPath = path.join(collectionsDirectory, "broken.md");
  const collection = {
    id: "collection-valid",
    title: "Valid",
    kind: "smart",
    query: { text: "keep" }
  };

  try {
    fs.mkdirSync(collectionsDirectory, { recursive: true });
    fs.writeFileSync(path.join(markdownDirectory, "library.md"), serializeLibrarySnapshotMarkdown(store.load()), "utf8");
    fs.writeFileSync(validPath, `---\nformat: clipboard-shelf\nversion: 1\nkind: collection\nid: collection-valid\ntitle: Valid\n---\n# Valid\n\n<!-- clipboard-shelf:collection ${JSON.stringify(collection)} -->\n`, "utf8");
    fs.writeFileSync(brokenPath, `---
format: clipboard-shelf
version: 1
kind: collection
id: collection-broken
title: Broken
---
# Broken

<!-- clipboard-shelf:collection ${JSON.stringify({
      id: "collection-broken",
      title: "Broken",
      kind: "smart",
      query: { type: "video" }
    })} -->
`, "utf8");

    const loaded = store.load();

    assert.deepEqual(loaded.smartCollections, [collection]);
    assert.equal(fs.existsSync(brokenPath), false);
    assert.equal(fs.readdirSync(collectionsDirectory).some((name) => name.includes("recovery-")), true);
    assert.equal(fs.existsSync(validPath), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store migrates the previous schema without creating a recovery file", () => {
  const { root, store } = makeStore();
  const dataFile = path.join(root, "library.json");

  try {
    fs.writeFileSync(dataFile, JSON.stringify({
      schemaVersion: 1,
      settings: { theme: "dark", autoCapture: false },
      pinned: [],
      normal: []
    }), "utf8");

    const migrated = store.load();
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(migrated.settings.theme, "dark");
    assert.equal(migrated.settings.autoCapture, false);
    assert.deepEqual(migrated.linkGroups, []);
    assert.equal(fs.existsSync(dataFile), true);
    assert.equal(fs.existsSync(path.join(root, "markdown", "library.md")), true);
    assert.equal(fs.readdirSync(root).some((name) => name.includes("recovery-")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store rotates automatic backups and restores a validated backup", () => {
  const { root, store } = makeStore();

  try {
    const library = store.load();
    store.save(library);
    store.save({ ...library, settings: { ...library.settings, theme: "dark" } });

    const backups = store.listBackups();
    assert.equal(backups.length, 1);
    assert.match(backups[0], /\.md$/);
    assert.equal(store.restoreBackup(backups[0]).settings.theme, "light");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store recovers a pending journal after an interrupted write", () => {
  const { root, store } = makeStore();
  const markdownDirectory = path.join(root, "markdown");
  const markdownFile = path.join(markdownDirectory, "library.md");
  const journalFile = `${markdownFile}.pending`;

  try {
    fs.mkdirSync(markdownDirectory, { recursive: true });
    fs.writeFileSync(journalFile, serializeLibrarySnapshotMarkdown({
      schemaVersion: 2,
      settings: {
        theme: "dark",
        duplicatePolicy: "dedupe-move-to-top",
        normalLimit: 150,
        autoCapture: true,
        batchSeparator: "<<<CLIPBOARD-ITEM>>>",
        globalShortcutEnabled: false
      },
      pinned: [],
      normal: [],
      linkGroups: []
    }), "utf8");

    assert.equal(store.load().settings.theme, "dark");
    assert.equal(fs.existsSync(markdownFile), true);
    assert.equal(fs.existsSync(journalFile), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store migrates legacy JSON into Markdown without deleting the source", () => {
  const { root, store } = makeStore();
  const dataFile = path.join(root, "library.json");
  const legacyLibrary = {
    schemaVersion: 2,
    settings: {
      theme: "dark",
      duplicatePolicy: "dedupe-move-to-top",
      normalLimit: 150,
      autoCapture: true,
      batchSeparator: "<<<CLIPBOARD-ITEM>>>",
      globalShortcutEnabled: false
    },
    pinned: [],
    normal: [{ id: "legacy-text", type: "text", text: "legacy content", createdAt: 1, updatedAt: 1 }],
    linkGroups: [{ id: "legacy-group", name: "Legacy", links: ["https://example.com"], createdAt: 1, updatedAt: 1 }]
  };

  try {
    fs.writeFileSync(dataFile, JSON.stringify(legacyLibrary), "utf8");
    assert.deepEqual(store.load().normal[0].text, "legacy content");
    assert.equal(fs.existsSync(dataFile), true);
    assert.equal(fs.existsSync(path.join(root, "markdown", "library.md")), true);
    assert.equal(fs.readdirSync(path.join(root, "markdown", "groups")).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store prefers the previous canonical JSON over an older fallback copy", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-store-priority-"));
  const canonicalJson = path.join(root, "clipboard-shelf-data", "library.json");
  const fallbackJson = path.join(root, "library.json");
  const store = createLibraryStore({
    dataFile: canonicalJson,
    legacyDataFile: fallbackJson,
    mediaDirectory: path.join(root, "clipboard-shelf-data", "media"),
    markdownDirectory: path.join(root, "clipboard-shelf-data", "markdown"),
    backupDirectory: path.join(root, "clipboard-shelf-data", "backups")
  });
  const baseLibrary = store.load();

  try {
    fs.mkdirSync(path.dirname(canonicalJson), { recursive: true });
    fs.writeFileSync(canonicalJson, JSON.stringify({
      ...baseLibrary,
      normal: [{ id: "canonical", type: "text", text: "canonical", createdAt: 1, updatedAt: 1 }]
    }), "utf8");
    fs.writeFileSync(fallbackJson, JSON.stringify({
      ...baseLibrary,
      normal: [{ id: "fallback", type: "text", text: "fallback", createdAt: 1, updatedAt: 1 }]
    }), "utf8");

    assert.equal(store.load().normal[0].id, "canonical");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store recovers malformed Markdown as a separate file", () => {
  const { root, store } = makeStore();
  const markdownFile = path.join(root, "markdown", "library.md");

  try {
    fs.mkdirSync(path.dirname(markdownFile), { recursive: true });
    fs.writeFileSync(markdownFile, "# broken\n", "utf8");
    assert.equal(store.load().schemaVersion, 2);
    assert.equal(store.hasData(), false);
    assert.equal(fs.existsSync(markdownFile), false);
    assert.equal(fs.readdirSync(path.dirname(markdownFile)).some((name) => name.includes("recovery-")), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store rejects oversized images and removes only orphan media", () => {
  const { root } = makeStore();
  const store = createLibraryStore({
    dataFile: path.join(root, "library.json"),
    mediaDirectory: path.join(root, "media"),
    maxImageBytes: 10
  });

  try {
    assert.throws(() => store.writeImage("too-large", ONE_PIXEL_PNG), /too large/i);
    const safeStore = createLibraryStore({
      dataFile: path.join(root, "library.json"),
      mediaDirectory: path.join(root, "media")
    });
    safeStore.writeImage("kept", ONE_PIXEL_PNG);
    safeStore.writeImage("orphan", ONE_PIXEL_PNG);
    const removed = safeStore.cleanupMedia({
      pinned: [{ type: "image", image: { blobKey: "kept" } }],
      normal: []
    });
    assert.equal(removed, 1);
    assert.equal(safeStore.readImage("kept"), ONE_PIXEL_PNG);
    assert.equal(safeStore.readImage("orphan"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store keeps image media referenced only from trash during cleanup", () => {
  const { root, store } = makeStore();

  try {
    const kept = store.writeImage("trash-only", ONE_PIXEL_PNG);
    store.writeImage("orphan", ONE_PIXEL_PNG);

    const removed = store.cleanupMedia({
      pinned: [],
      normal: [],
      trash: [{
        id: "trash-1",
        entry: {
          id: "entry-image-1",
          type: "image",
          image: {
            blobKey: kept.mediaKey,
            mimeType: kept.mimeType,
            size: kept.size,
            hash: kept.sha256
          },
          tags: [],
          createdAt: 1,
          updatedAt: 1
        },
        originalList: "normal",
        deletedAt: 2
      }]
    });

    assert.equal(removed, 2);
    assert.equal(store.readImage(kept.mediaKey), ONE_PIXEL_PNG);
    assert.equal(store.readImage("orphan"), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store rejects invalid link groups at the persistence boundary", () => {
  const { root, store } = makeStore();

  try {
    assert.throws(() => store.save({
      schemaVersion: 2,
      settings: {
        theme: "light",
        duplicatePolicy: "dedupe-move-to-top",
        normalLimit: 150,
        autoCapture: true,
        batchSeparator: "<<<CLIPBOARD-ITEM>>>"
      },
      pinned: [],
      normal: [],
      linkGroups: [{ id: "bad", name: "Bad", links: ["file:///secret"] }]
    }), /malformed library|collection query type|invalid/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store rejects malformed smart collections and trash records at the persistence boundary", () => {
  const { root, store } = makeStore();
  const defaults = store.load();

  try {
    assert.throws(() => store.save({
      ...defaults,
      smartCollections: [{
        id: "collection-1",
        title: "Unsafe",
        kind: "smart",
        query: {
          type: "video"
        }
      }]
    }), /malformed library|collection query type|invalid/i);

    assert.throws(() => store.save({
      ...defaults,
      pinned: [{
        id: "entry-1",
        type: "text",
        text: "active",
        tags: [],
        createdAt: 1,
        updatedAt: 1
      }],
      trash: [{
        id: "trash-1",
        entry: {
          id: "entry-1",
          type: "text",
          text: "duplicate id",
          tags: [],
          createdAt: 1,
          updatedAt: 1
        },
        originalList: "archive",
        deletedAt: -1
      }]
    }), /malformed library|duplicate entry id|trash originalList|invalid/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("library store rejects a Trash record that omits deletedAt", () => {
  const { root, store } = makeStore();
  const defaults = store.load();

  try {
    assert.throws(() => store.save({
      ...defaults,
      trash: [{
        id: "trash-missing-deleted-at",
        entry: {
          id: "entry-trash-missing-deleted-at",
          type: "text",
          text: "recoverable text",
          tags: [],
          createdAt: 1,
          updatedAt: 1
        },
        originalList: "normal"
      }]
    }), /deletedAt/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
