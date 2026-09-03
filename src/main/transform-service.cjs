const os = require("node:os");
const path = require("node:path");

const { createImageDragFile } = require("../../image-drag.cjs");
const { transformText, isSupportedOperation } = require("../../text-transforms.cjs");

const TEXT_MODES = new Map([
  ["plain", "text/plain"],
  ["markdown", "text/markdown"],
  ["html", "text/html"],
  ["json", "application/json"]
]);

const DERIVED_TEXT_MODE = "derived-text";

function assertItem(item) {
  if (!item || typeof item !== "object") {
    throw new TypeError("Clipboard item is required");
  }

  if (item.type === "text" && typeof item.text !== "string") {
    throw new TypeError("Text item must contain text");
  }

  if (item.type !== "text" && item.type !== "image") {
    throw new TypeError("Unsupported clipboard item type");
  }
}

function escapeHtml(text) {
  return text.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;"
  }[character]));
}

function textOutput(item, mode) {
  const mimeType = TEXT_MODES.get(mode);

  if (!mimeType) {
    throw new RangeError(`Unsupported text transform mode: ${mode}`);
  }

  if (mode === "html") {
    return {
      mimeType,
      text: `<div>${escapeHtml(item.text).replace(/\r\n?|\n/g, "<br>\n")}</div>`
    };
  }

  if (mode === "json") {
    return { mimeType, text: JSON.stringify(item) };
  }

  return { mimeType, text: item.text };
}

function derivedTextOutput(item, operation, options) {
  if (item.type !== "text") {
    throw new RangeError("Derived text transforms require a text item");
  }

  if (!isSupportedOperation(operation)) {
    throw new RangeError(`Unsupported derived transform operation: ${operation}`);
  }

  const result = transformText(item.text, operation, options);

  return {
    mimeType: "text/plain",
    text: result.text,
    operation: result.operation,
    sourceLength: result.sourceLength
  };
}

function imageOutput(item, mode) {
  if (mode !== "image") {
    throw new RangeError(`Unsupported image transform mode: ${mode}`);
  }

  const dataUrl = item.image?.dataUrl;
  if (typeof dataUrl !== "string" || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    throw new TypeError("Image data URL is required");
  }

  return {
    mimeType: item.image.mimeType || dataUrl.slice(5, dataUrl.indexOf(";")),
    dataUrl
  };
}

class TransformService {
  static toClipboard(item, mode = item?.type === "image" ? "image" : "plain", options = {}) {
    assertItem(item);

    if (item.type === "image") {
      return imageOutput(item, mode);
    }

    if (mode === DERIVED_TEXT_MODE) {
      return derivedTextOutput(item, options?.operation, options?.transformOptions);
    }

    return textOutput(item, mode);
  }

  static toDerivedText(item, operation, options = {}) {
    assertItem(item);
    return derivedTextOutput(item, operation, options);
  }

  static toDragFile(item, mode = "png", options = {}) {
    assertItem(item);

    if (item.type !== "image") {
      throw new RangeError("Only image items can be exported as drag files");
    }

    const output = imageOutput(item, "image");
    const mimeType = output.mimeType.toLowerCase();

    if (mode !== "image" && mode !== "png") {
      throw new RangeError(`Unsupported image drag mode: ${mode}`);
    }

    if (mode === "png" && mimeType !== "image/png") {
      throw new RangeError("PNG drag mode requires a PNG source");
    }

    const dragDirectory = typeof options.dragDirectory === "string" && options.dragDirectory
      ? options.dragDirectory
      : path.join(os.tmpdir(), "clipboard-shelf-drag");
    const mediaKey = item.image.blobKey || item.id;

    return createImageDragFile(mediaKey, output.dataUrl, dragDirectory);
  }
}

TransformService.DERIVED_TEXT_MODE = DERIVED_TEXT_MODE;

module.exports = { TransformService };
