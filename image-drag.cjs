const fs = require("node:fs");
const path = require("node:path");

const SAFE_MEDIA_KEY = /^[a-zA-Z0-9._-]+$/;
const IMAGE_DATA_URL_PATTERN = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;
const EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["image/bmp", ".bmp"],
  ["image/svg+xml", ".svg"]
]);

function assertSafeMediaKey(mediaKey) {
  if (typeof mediaKey !== "string" || !SAFE_MEDIA_KEY.test(mediaKey)) {
    throw new TypeError("Invalid media key");
  }
}

function parseImageDataUrl(dataUrl) {
  const match = typeof dataUrl === "string" ? IMAGE_DATA_URL_PATTERN.exec(dataUrl) : null;

  if (!match) {
    throw new TypeError("Invalid image data URL");
  }

  return {
    extension: EXTENSIONS.get(match[1].toLowerCase()) || ".img",
    bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64")
  };
}

function resolveDragFilePath(mediaKey, extension, dragDirectory) {
  const root = path.resolve(dragDirectory);
  const filePath = path.join(root, `clipboard-shelf-${mediaKey}${extension}`);
  const relative = path.relative(root, filePath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("Image drag file escapes its directory");
  }

  return { root, filePath };
}

function createImageDragFile(mediaKey, dataUrl, dragDirectory) {
  assertSafeMediaKey(mediaKey);
  const image = parseImageDataUrl(dataUrl);
  const dragFile = resolveDragFilePath(mediaKey, image.extension, dragDirectory);

  fs.mkdirSync(dragFile.root, { recursive: true });
  fs.writeFileSync(dragFile.filePath, image.bytes);
  return { filePath: dragFile.filePath, extension: image.extension };
}

module.exports = { createImageDragFile };
