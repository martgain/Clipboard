const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parseLibraryMarkdown,
  parseLinkGroupMarkdown,
  serializeCollectionFile,
  safeGroupFileName,
  serializeLibraryMarkdown,
  serializeLibrarySnapshotMarkdown,
  serializeLinkGroupMarkdown
} = require("../markdown-library.cjs");

const LIBRARY = {
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
  pinned: [],
  normal: [{
    id: "entry-1",
    type: "text",
    text: "عنوان\n  سطر فيه مسافات و `backticks`\n***",
    tags: ["مهم"],
    createdAt: 1,
    updatedAt: 2
  }],
  smartCollections: [],
  trash: [],
  linkGroups: [{
    id: "group-1",
    name: "شغلي / Chrome",
    icon: "briefcase",
    links: ["https://example.com", "https://example.org/path"],
    createdAt: 3,
    updatedAt: 4
  }]
};

test("markdown library preserves exact text and group data across a round trip", () => {
  const parsed = parseLibraryMarkdown(serializeLibrarySnapshotMarkdown(LIBRARY));

  assert.deepEqual(parsed, LIBRARY);
});

test("library markdown emits empty smart collection and trash markers and old markdown still loads empty arrays", () => {
  const serialized = serializeLibraryMarkdown(LIBRARY);
  const legacyMarkdown = serialized
    .replace(/^<!-- clipboard-shelf:smart-collections [^\n]* -->\r?\n?/m, "")
    .replace(/^<!-- clipboard-shelf:trash [^\n]* -->\r?\n?/m, "");
  const parsed = parseLibraryMarkdown(legacyMarkdown);

  assert.match(serialized, /clipboard-shelf:smart-collections/);
  assert.match(serialized, /clipboard-shelf:trash/);
  assert.deepEqual(parsed.smartCollections, []);
  assert.deepEqual(parsed.trash, []);
});

test("link group markdown keeps its title, icon, and normalized links", () => {
  const group = LIBRARY.linkGroups[0];
  const parsed = parseLinkGroupMarkdown(serializeLinkGroupMarkdown(group));

  assert.deepEqual(parsed, group);
});

test("generic saved lists preserve ordinary text and multiline items", () => {
  const group = {
    id: "group-text-1",
    name: "ملاحظات سريعة",
    icon: "book",
    items: ["أول عنصر\nبسطرين", "  مسافات محفوظة  ", "رموز `و *** كما هي"],
    createdAt: 5,
    updatedAt: 6
  };

  assert.deepEqual(parseLinkGroupMarkdown(serializeLinkGroupMarkdown(group)), group);
});

test("markdown metadata preserves comment-like user content", () => {
  const library = {
    ...LIBRARY,
    settings: { ...LIBRARY.settings, searchQuery: "-->" },
    normal: [{ ...LIBRARY.normal[0], tags: ["-->", "<!--"] }]
  };

  assert.deepEqual(parseLibraryMarkdown(serializeLibrarySnapshotMarkdown(library)), library);
});

test("markdown entries preserve safe clipboard source and rich-format metadata", () => {
  const metadata = {
    sourceApp: { executable: "notepad.exe", pid: 42 },
    formats: ["text", "html"],
    richFormats: [{ format: "html", mimeType: "text/html", size: 12, sha256: "a".repeat(64) }]
  };
  const library = {
    ...LIBRARY,
    normal: [{ ...LIBRARY.normal[0], ...metadata }]
  };

  assert.deepEqual(parseLibraryMarkdown(serializeLibrarySnapshotMarkdown(library)), library);
});

test("markdown entries preserve bounded note, title, domain, tags, and exact text", () => {
  const entry = {
    ...LIBRARY.normal[0],
    text: "  exact link text\nwith spaces  ",
    note: "  note\nwith spaces  ",
    title: "Read later",
    domain: "example.com",
    tags: ["keep", "also-keep"]
  };
  const library = { ...LIBRARY, normal: [entry] };

  assert.deepEqual(parseLibraryMarkdown(serializeLibraryMarkdown(library)).normal[0], entry);
});

test("new Markdown begins with fixed typed frontmatter before legacy markers", () => {
  const serialized = serializeLibraryMarkdown(LIBRARY);

  assert.match(serialized, /^---\nformat: clipboard-shelf\nversion: 1\nkind: library\n---\n/);
  assert.match(serialized, /<!-- clipboard-shelf:format /);
});

test("portable Markdown uses a safe attachment path while legacy blob keys still load", () => {
  const image = {
    id: "image-1",
    type: "image",
    image: {
      blobKey: "a".repeat(64),
      mimeType: "image/png",
      size: 68,
      hash: "a".repeat(64)
    },
    tags: [],
    createdAt: 1,
    updatedAt: 2
  };
  const library = { ...LIBRARY, normal: [image] };
  const serialized = serializeLibraryMarkdown(library, { portable: true });

  assert.match(serialized, new RegExp(`"path":"media/${image.image.blobKey}\\.media"`));
  assert.deepEqual(parseLibraryMarkdown(serialized).normal[0], image);
  assert.deepEqual(parseLibraryMarkdown(serializeLibraryMarkdown(library, { portable: false })).normal[0], image);
});

test("collection Markdown file names and contents are deterministic", () => {
  assert.equal(typeof serializeCollectionFile, "function");
  const collection = {
    id: "collection-1",
    title: "  Work / Links  ",
    kind: "smart",
    query: { text: "release" }
  };

  const first = serializeCollectionFile(collection, "C:\\portable\\collections");
  const second = serializeCollectionFile(collection, "C:\\portable\\collections");

  assert.equal(first.path, second.path);
  assert.equal(first.contents, second.contents);
  assert.match(first.path, /collection-work-links-collection-1\.md$/);
  assert.match(first.contents, /^---\nformat: clipboard-shelf\nversion: 1\nkind: collection\n/);
});

test("smart collections round-trip as query-only records without copied items or entries", () => {
  const library = {
    ...LIBRARY,
    smartCollections: [{
      id: "collection-1",
      title: "Saved Work",
      kind: "smart",
      query: {
        text: "release",
        type: "text",
        tags: ["work", "release"],
        sourceApps: ["Code.exe"],
        tagMode: "any",
        dateFrom: "2026-08-31T00:00:00.000Z",
        dateTo: 1788134400000
      }
    }]
  };
  const parsed = parseLibraryMarkdown(serializeLibraryMarkdown(library));

  assert.deepEqual(parsed.smartCollections, library.smartCollections);
  assert.equal("items" in parsed.smartCollections[0], false);
  assert.equal("entry" in parsed.smartCollections[0], false);
});

test("trash markdown preserves exact nested text snapshots", () => {
  const exactText = "  بداية\nسطر وسط\nسطر أخير مع مسافات  \n";
  const library = {
    ...LIBRARY,
    trash: [{
      id: "trash-1",
      entry: {
        id: "entry-trash-1",
        type: "text",
        text: exactText,
        tags: ["archive"],
        createdAt: 11,
        updatedAt: 22
      },
      originalList: "pinned",
      deletedAt: 33
    }]
  };
  const parsed = parseLibraryMarkdown(serializeLibrarySnapshotMarkdown(library));

  assert.deepEqual(parsed.trash, library.trash);
  assert.equal(parsed.trash[0].entry.text, exactText);
});

test("group filenames stay inside the groups directory and remain deterministic", () => {
  const firstName = safeGroupFileName({ id: "group/1", name: "  شغلي / Chrome  " });
  const secondName = safeGroupFileName({ id: "group/1", name: "  شغلي / Chrome  " });

  assert.equal(firstName, secondName);
  assert.match(firstName, /^[a-z0-9-]+\.md$/i);
  assert.equal(firstName.includes("/"), false);
  assert.equal(firstName.includes("\\"), false);
});
