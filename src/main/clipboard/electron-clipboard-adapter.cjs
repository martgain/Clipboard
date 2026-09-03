const { ClipboardAdapter } = require("../clipboard-adapter.cjs");
const {
  MAX_IMAGE_BYTES,
  assertImageBytes,
  sha256Hex
} = require("../../shared/validation.cjs");

class UnsupportedClipboardFeatureError extends Error {
  constructor(feature, message = `Clipboard feature is unsupported: ${feature}`) {
    super(message);
    this.name = "UnsupportedClipboardFeatureError";
    this.code = "CLIPBOARD_FEATURE_UNSUPPORTED";
    this.feature = feature;
  }
}

function requireMethod(target, method, feature) {
  if (!target || typeof target[method] !== "function") {
    throw new UnsupportedClipboardFeatureError(feature);
  }
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes);
  }
  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(bytes));
  }
  throw new TypeError("Clipboard image bytes are required");
}

function normalizeFormat(format) {
  if (typeof format !== "string") {
    return null;
  }

  const value = format.trim().toLowerCase();
  if (value === "text/plain" || value === "text") return "text";
  if (value.startsWith("image/")) return "image";
  if (value === "text/html" || value === "html") return "html";
  if (value === "text/rtf" || value === "application/rtf" || value === "rtf") return "rtf";
  if (value === "text/uri-list" || value === "bookmark") return "bookmark";
  if (value === "file" || value === "files" || value === "application/x-moz-file") return "file";
  return null;
}

function normalizedFormats(formats) {
  const rawFormats = Array.isArray(formats) ? formats : [];
  return [...new Set(rawFormats.map(normalizeFormat).filter(Boolean))];
}

function metadataForText(format, richText) {
  const bytes = Buffer.from(richText, "utf8");
  return { format, mimeType: format === "html" ? "text/html" : "text/rtf", size: bytes.length, sha256: sha256Hex(bytes) };
}

function findImageClipboardItem(clipboardItems) {
  return clipboardItems.find((clipboardItem) => clipboardItem && Array.isArray(clipboardItem.types)
    && clipboardItem.types.some((format) => typeof format === "string" && format.toLowerCase().startsWith("image/")));
}

async function readImageClipboardItem(imageItem, maxImageBytes) {
  const mimeType = imageItem.types.find((format) => typeof format === "string" && format.toLowerCase().startsWith("image/"));
  if (typeof imageItem.getType !== "function") {
    throw new UnsupportedClipboardFeatureError("image blob read");
  }
  const imageBlob = await imageItem.getType(mimeType);
  if (!imageBlob || typeof imageBlob.arrayBuffer !== "function") {
    throw new TypeError("Electron clipboard image blob is invalid");
  }
  if (Number.isSafeInteger(imageBlob.size) && imageBlob.size > maxImageBytes) {
    throw new RangeError("Clipboard image bytes are too large");
  }

  const imageBytes = assertImageBytes(toBuffer(await imageBlob.arrayBuffer()), mimeType, maxImageBytes);
  return {
    mimeType: mimeType.toLowerCase(),
    bytes: imageBytes,
    sha256: sha256Hex(imageBytes),
    size: imageBytes.length
  };
}

async function readRichTextMetadata(clipboard, requestedFormats, format, method) {
  if (!requestedFormats.includes(format) || typeof clipboard[method] !== "function") {
    return null;
  }
  const richText = await clipboard[method]();
  return typeof richText === "string" && richText.length > 0
    ? metadataForText(format, richText)
    : null;
}

async function readBookmarkMetadata(clipboard, requestedFormats) {
  if (!requestedFormats.includes("bookmark") || typeof clipboard.readBookmark !== "function") {
    return null;
  }
  const bookmark = await clipboard.readBookmark();
  if (!bookmark || typeof bookmark !== "object") {
    return null;
  }
  return {
    format: "bookmark",
    ...(typeof bookmark.title === "string" ? { title: bookmark.title } : {}),
    ...(typeof bookmark.url === "string" ? { url: bookmark.url } : {})
  };
}

function snapshotFormats(requestedFormats, availableFormats, imageSnapshot) {
  return [...new Set([
    ...requestedFormats,
    ...availableFormats,
    ...(imageSnapshot ? ["image"] : [])
  ])];
}

function createClipboardSnapshot({ sequence, capturedAt, sourceApp, formats, richFormats, payload }) {
  return {
    ...(sequence === undefined ? {} : { sequence }),
    ...(capturedAt === undefined ? {} : { capturedAt }),
    ...(sourceApp === undefined ? {} : { sourceApp }),
    formats,
    richFormats,
    payload
  };
}

class ElectronClipboardAdapter {
  constructor({
    clipboard,
    ClipboardItem = globalThis.ClipboardItem,
    Blob = globalThis.Blob,
    nativeImage,
    maxImageBytes = MAX_IMAGE_BYTES
  } = {}) {
    if (!clipboard || typeof clipboard !== "object") {
      throw new TypeError("Electron clipboard is required");
    }
    if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes < 1) {
      throw new RangeError("Clipboard image byte limit is invalid");
    }

    this.clipboard = clipboard;
    this.ClipboardItem = ClipboardItem;
    this.Blob = Blob;
    this.maxImageBytes = maxImageBytes;
    this.textAdapter = new ClipboardAdapter({ clipboard, ClipboardItem, Blob });
  }

  readText() {
    requireMethod(this.clipboard, "readText", "text read");
    return this.textAdapter.readText();
  }

  async readImage() {
    requireMethod(this.clipboard, "read", "image read");
    const clipboardItems = await this.clipboard.read();
    if (!Array.isArray(clipboardItems)) {
      throw new TypeError("Electron clipboard image items must be an array");
    }

    const imageItem = findImageClipboardItem(clipboardItems);
    if (!imageItem) {
      return null;
    }
    return readImageClipboardItem(imageItem, this.maxImageBytes);
  }

  availableFormats() {
    if (typeof this.clipboard.availableFormats !== "function") {
      return [];
    }
    const formats = this.clipboard.availableFormats();
    if (!Array.isArray(formats)) {
      throw new TypeError("Electron clipboard formats must be an array");
    }
    return formats.slice();
  }

  async readRichMetadata(formats = undefined) {
    const available = this.availableFormats();
    const requested = normalizedFormats(formats || available).filter((format) => ["html", "rtf", "bookmark"].includes(format));
    const metadata = [];
    for (const [format, method] of [["html", "readHTML"], ["rtf", "readRTF"]]) {
      const richMetadata = await readRichTextMetadata(this.clipboard, requested, format, method);
      if (richMetadata) {
        metadata.push(richMetadata);
      }
    }
    const bookmarkMetadata = await readBookmarkMetadata(this.clipboard, requested);
    if (bookmarkMetadata) {
      metadata.push(bookmarkMetadata);
    }
    return metadata;
  }

  async readSnapshot({ formats = undefined, sequence = undefined, capturedAt = undefined, sourceApp = undefined } = {}) {
    const availableRawFormats = this.availableFormats();
    const requestedFormats = normalizedFormats(formats || availableRawFormats);
    const availableFormats = normalizedFormats(availableRawFormats);
    const shouldProbeImage = requestedFormats.includes("image")
      || availableFormats.includes("image")
      || typeof this.clipboard.read === "function";
    const imageSnapshot = shouldProbeImage ? await this.readImage() : null;
    const clipboardFormats = snapshotFormats(requestedFormats, availableFormats, imageSnapshot);
    const richFormats = await this.readRichMetadata(formats);
    if (imageSnapshot) {
      return createClipboardSnapshot({
        sequence,
        capturedAt,
        sourceApp,
        formats: clipboardFormats,
        richFormats,
        payload: {
          kind: "image",
          mimeType: imageSnapshot.mimeType,
          bytes: imageSnapshot.bytes,
          sha256: imageSnapshot.sha256,
          size: imageSnapshot.size
        }
      });
    }

    const text = await this.readText();
    if (typeof text !== "string") {
      throw new TypeError("Electron clipboard text must be a string");
    }

    const textFormats = clipboardFormats.includes("text") ? clipboardFormats : ["text", ...clipboardFormats];
    return createClipboardSnapshot({
      sequence,
      capturedAt,
      sourceApp,
      formats: textFormats,
      richFormats,
      payload: { kind: "text", text }
    });
  }

  writeText(text) {
    if (typeof text !== "string") {
      throw new TypeError("Clipboard text must be a string");
    }
    requireMethod(this.clipboard, "writeText", "text write");
    return this.textAdapter.writeText(text);
  }

  async writeImage(dataUrl) {
    if (typeof dataUrl !== "string") {
      throw new TypeError("Clipboard image data URL must be a string");
    }
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl);
    if (!match) {
      throw new TypeError("Clipboard image must be a base64 image data URL");
    }
    requireMethod(this.clipboard, "write", "image write");
    if (typeof this.ClipboardItem !== "function" || typeof this.Blob !== "function") {
      throw new UnsupportedClipboardFeatureError("image write");
    }

    const bytes = assertImageBytes(Buffer.from(match[2], "base64"), match[1], this.maxImageBytes);
    const blob = new this.Blob([bytes], { type: match[1] });
    await this.clipboard.write([new this.ClipboardItem({ [match[1]]: blob })]);
  }
}

module.exports = Object.freeze({ ElectronClipboardAdapter, UnsupportedClipboardFeatureError });
