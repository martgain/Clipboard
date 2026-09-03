const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PNG } = require("pngjs");

const { createFeatureServices } = require("../src/main/feature-services.cjs");
const { CHANNELS, validatePayload } = require("../src/shared/contracts.cjs");

function makeServices(options = {}) {
  return createFeatureServices({
    getLibraryStore: () => options.libraryStore || {},
    writeClipboardText: options.writeClipboardText || (async () => {}),
    ocrIndexPath: options.ocrIndexPath || null
  });
}

test("feature services write the selected entries as one ordered paste sequence", async () => {
  let clipboardText = null;
  const services = makeServices({
    writeClipboardText: async (text) => {
      clipboardText = text;
    }
  });

  try {
    const sequence = await services.writePasteSequence([
      { id: "first", text: "first\n" },
      { id: "second", text: "second" }
    ], { separator: "\n---\n", order: ["second", "first"] });

    assert.equal(clipboardText, "second\n---\nfirst\n");
    assert.deepEqual(sequence.entries, ["second", "first\n"]);
  } finally {
    await services.close();
  }
});

test("feature services preserve and normalize collection parent references on load", async () => {
  const services = makeServices();
  const source = {
    schemaVersion: 2,
    smartCollections: [
      { id: "root", title: "Root", kind: "manual", itemIds: [] },
      { id: "child", title: "Child", kind: "manual", parentId: "root", itemIds: [] }
    ]
  };

  try {
    const normalized = services.normalizeLibraryForLoad(source);

    assert.equal(normalized.smartCollections[0].parentId, null);
    assert.equal(normalized.smartCollections[1].parentId, "root");
    assert.equal(Object.hasOwn(source.smartCollections[0], "parentId"), false);
    assert.notStrictEqual(normalized.smartCollections[0], source.smartCollections[0]);
  } finally {
    await services.close();
  }
});

test("feature services reject invalid collection parents before persistence", async () => {
  const services = makeServices();

  try {
    assert.throws(
      () => services.prepareLibraryForSave({
        smartCollections: [{ id: "child", title: "Child", kind: "manual", parentId: "missing" }]
      }),
      /unknown.*parent/i
    );
  } finally {
    await services.close();
  }
});

test("feature services delegate version history list and restore through the library store", async () => {
  const calls = [];
  const services = makeServices({
    libraryStore: {
      listVersionHistory: () => [{ id: "gen-1", manifestHash: "hash-1" }],
      restoreVersionHistory: (id) => {
        calls.push(id);
        return { sourceGeneration: id };
      }
    }
  });

  try {
    assert.deepEqual(services.listVersionHistory(), [{ id: "gen-1", manifestHash: "hash-1" }]);
    assert.deepEqual(services.restoreVersionHistory("gen-1"), { sourceGeneration: "gen-1" });
    assert.deepEqual(calls, ["gen-1"]);
  } finally {
    await services.close();
  }
});

test("feature services rebuild OCR metadata through the bounded background queue", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-runtime-"));
  const ocrIndexPath = path.join(root, "ocr-index.json");
  const services = makeServices({ ocrIndexPath });

  try {
    const result = await services.rebuildOcrIndex({
      pinned: [{ id: "image-1", type: "image", ocrText: "نص الصورة", ocr: { language: "ar" } }],
      normal: []
    });

    assert.equal(result.count, 1);
    assert.match(fs.readFileSync(ocrIndexPath, "utf8"), /نص الصورة/);
  } finally {
    await services.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("feature services expose local derived text and image analysis without network access", async () => {
  const services = makeServices();
  const png = new PNG({ width: 1, height: 1 });
  png.data.set([255, 0, 0, 255]);
  const dataUrl = `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;

  try {
    const transformed = services.transformText("a  b", "whitespace-cleanup", { collapseSpaces: true });
    assert.equal(transformed.text, "a b");
    assert.equal(transformed.operation, "whitespace-cleanup");
    const analysis = services.analyzeImage(dataUrl);
    assert.equal(analysis.colors.formats.hex, "#FF0000");
    assert.equal(analysis.codes.status, "unsupported");
  } finally {
    await services.close();
  }
});

test("runtime wiring exposes the feature channels and packaged adapter", () => {
  const projectRoot = path.join(__dirname, "..");
  const contractsSource = fs.readFileSync(path.join(projectRoot, "src/shared/contracts.cjs"), "utf8");
  const preloadSource = fs.readFileSync(path.join(projectRoot, "preload.cjs"), "utf8");
  const registerSource = fs.readFileSync(path.join(projectRoot, "src/main/ipc/register-ipc.cjs"), "utf8");
  const mainSource = fs.readFileSync(path.join(projectRoot, "main.cjs"), "utf8");
  const rendererSource = fs.readFileSync(path.join(projectRoot, "src/renderer/app.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

  assert.match(contractsSource, /libraryListVersionHistory/);
  assert.match(contractsSource, /libraryRestoreVersionHistory/);
  assert.match(contractsSource, /ocrIndexRebuild/);
  assert.match(contractsSource, /clipboardTransformText/);
  assert.match(contractsSource, /imageAnalyze/);
  assert.match(preloadSource, /listVersionHistory/);
  assert.match(preloadSource, /restoreVersionHistory/);
  assert.match(preloadSource, /rebuildOcrIndex/);
  assert.match(preloadSource, /transformText/);
  assert.match(preloadSource, /analyzeImage/);
  assert.match(registerSource, /libraryListVersionHistory/);
  assert.match(registerSource, /libraryRestoreVersionHistory/);
  assert.match(registerSource, /ocrIndexRebuild/);
  assert.match(registerSource, /clipboardTransformText/);
  assert.match(registerSource, /imageAnalyze/);
  assert.match(mainSource, /feature-services/);
  assert.match(rendererSource, /desktopApi\.writePasteSequence/);
  assert.match(rendererSource, /parentId/);
  assert.match(rendererSource, /smartCollectionDepth/);
  assert.ok(packageJson.build.files.includes("src/main/feature-services.cjs"));
  assert.ok(packageJson.build.files.includes("paste-sequence.cjs"));
  assert.ok(packageJson.build.files.includes("version-history.cjs"));
  assert.ok(packageJson.build.files.includes("background-index-queue.cjs"));
  assert.ok(packageJson.build.files.includes("ocr-language.cjs"));
  assert.ok(packageJson.build.files.includes("qr-detector.cjs"));
  assert.ok(packageJson.build.files.includes("color-analysis.cjs"));
  assert.ok(packageJson.build.files.includes("text-transforms.cjs"));
});

test("feature IPC contracts reject unsafe history and oversized sequence payloads", () => {
  assert.throws(
    () => validatePayload(CHANNELS.libraryRestoreVersionHistory, ["../../outside"]),
    /generation/i
  );
  assert.throws(
    () => validatePayload(CHANNELS.clipboardWriteSequence, [Array.from({ length: 151 }, () => "text")]),
    /sequence/i
  );
  assert.throws(
    () => validatePayload(CHANNELS.clipboardWriteSequence, [[{ text: "text", id: "" }]]),
    /sequence/i
  );
  assert.throws(
    () => validatePayload(CHANNELS.clipboardTransformText, ["text", "unknown-operation"]),
    /transform/i
  );
  assert.throws(
    () => validatePayload(CHANNELS.imageAnalyze, ["file:///outside"]),
    /image analysis/i
  );
});
