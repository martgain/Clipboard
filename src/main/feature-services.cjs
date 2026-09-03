const { buildPasteSequence } = require("../../paste-sequence.cjs");
const { validateCollectionTree } = require("../../collection-tree.cjs");
const { BackgroundIndexQueue } = require("../../background-index-queue.cjs");
const { detectCodes } = require("../../qr-detector.cjs");
const { analyzeImageColors } = require("../../color-analysis.cjs");
const { TransformService } = require("./transform-service.cjs");
const { OcrIndex } = require("./ocr/ocr-index.cjs");

function cloneCollectionRecords(collections) {
  return Array.isArray(collections) ? collections.map((collection) => ({ ...collection })) : [];
}

function normalizeCollectionsForLoad(collections) {
  const candidates = cloneCollectionRecords(collections);

  try {
    return validateCollectionTree(candidates);
  } catch (collectionError) {
    if (!(collectionError instanceof TypeError || collectionError instanceof RangeError)) {
      throw collectionError;
    }
    return candidates.map((collection) => ({ ...collection, parentId: null }));
  }
}

function normalizeLibraryForLoad(library) {
  if (!library || typeof library !== "object") {
    throw new TypeError("Library state is required");
  }

  return {
    ...library,
    smartCollections: normalizeCollectionsForLoad(library.smartCollections)
  };
}

function prepareLibraryForSave(library) {
  if (!library || typeof library !== "object") {
    throw new TypeError("Library state is required");
  }

  return {
    ...library,
    smartCollections: validateCollectionTree(cloneCollectionRecords(library.smartCollections))
  };
}

function allLibraryEntries(library) {
  return [
    ...(Array.isArray(library?.pinned) ? library.pinned : []),
    ...(Array.isArray(library?.normal) ? library.normal : [])
  ];
}

function toOcrIndexEntry(entry) {
  const ocrMetadata = entry?.ocr && typeof entry.ocr === "object" ? entry.ocr : {};
  const extractedText = typeof entry?.ocrText === "string" ? entry.ocrText : ocrMetadata.text;

  if (typeof entry?.id !== "string" || typeof extractedText !== "string" || !extractedText.trim()) {
    return null;
  }

  return {
    entryId: entry.id,
    text: extractedText,
    language: ocrMetadata.language,
    engine: ocrMetadata.engine,
    confidence: ocrMetadata.confidence,
    capturedAt: entry.capturedAt
  };
}

function collectOcrIndexEntries(library) {
  return allLibraryEntries(library).map(toOcrIndexEntry).filter(Boolean);
}

function assertServiceDependencies({ getLibraryStore, writeClipboardText }) {
  if (typeof getLibraryStore !== "function" || typeof writeClipboardText !== "function") {
    throw new TypeError("Feature service dependencies are required");
  }
}

function decodeImageDataUrl(dataUrl) {
  const match = typeof dataUrl === "string"
    ? /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
    : null;
  if (!match) {
    throw new TypeError("Image data URL is invalid");
  }
  return { mimeType: match[1].toLowerCase(), bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
}

function createFeatureServices({ getLibraryStore, writeClipboardText, ocrIndexPath = null } = {}) {
  assertServiceDependencies({ getLibraryStore, writeClipboardText });
  const indexQueue = new BackgroundIndexQueue({ concurrency: 1 });
  const ocrIndex = typeof ocrIndexPath === "string" && ocrIndexPath
    ? new OcrIndex({ filePath: ocrIndexPath, persistQueue: indexQueue })
    : null;
  let closePromise = null;

  async function writePasteSequence(entries, options) {
    const sequence = buildPasteSequence(entries, options);
    await writeClipboardText(sequence.text);
    return sequence;
  }

  function listVersionHistory() {
    return getLibraryStore().listVersionHistory();
  }

  function restoreVersionHistory(generation) {
    return getLibraryStore().restoreVersionHistory(generation);
  }

  function transformText(text, operation, options) {
    return TransformService.toDerivedText({ type: "text", text }, operation, options);
  }

  function analyzeImage(dataUrl) {
    const { mimeType, bytes } = decodeImageDataUrl(dataUrl);
    let colors = { status: "unsupported", dominant: null, palette: [], formats: null };
    if (mimeType === "image/png") {
      try {
        colors = { status: "ok", ...analyzeImageColors(bytes) };
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error;
        }
        colors = { status: "unavailable", dominant: null, palette: [], formats: null, code: error?.code || "COLOR_ANALYSIS_FAILED" };
      }
    }
    return { mimeType, colors, codes: detectCodes(bytes) };
  }

  async function rebuildOcrIndex(library) {
    if (!ocrIndex) {
      return { count: 0, enabled: false };
    }

    return {
      ...(await ocrIndex.rebuild(collectOcrIndexEntries(library))),
      enabled: true
    };
  }

  function close() {
    if (!closePromise) {
      closePromise = indexQueue.close();
    }

    return closePromise;
  }

  return Object.freeze({
    writePasteSequence,
    listVersionHistory,
    restoreVersionHistory,
    transformText,
    analyzeImage,
    rebuildOcrIndex,
    normalizeLibraryForLoad,
    prepareLibraryForSave,
    close
  });
}

module.exports = { createFeatureServices };
