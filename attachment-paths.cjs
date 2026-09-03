const path = require("node:path");

const MEDIA_KEY_PATTERN = /^[a-f0-9]{64}$/i;
const ATTACHMENT_PATH_PATTERN = /^(media|attachments)\/([a-f0-9]{64})\.([a-z0-9]+)$/i;
const ATTACHMENT_DIRECTORIES = new Set(["media", "attachments"]);

function assertMediaKey(mediaKey) {
  if (typeof mediaKey !== "string" || !MEDIA_KEY_PATTERN.test(mediaKey)) {
    throw new TypeError("Attachment media key is invalid");
  }
}

function buildRelativeAttachmentPath(mediaKey, directory = "media") {
  assertMediaKey(mediaKey);
  if (!ATTACHMENT_DIRECTORIES.has(directory)) {
    throw new TypeError("Attachment directory is invalid");
  }
  return `${directory}/${mediaKey.toLowerCase()}.media`;
}

function parseAttachmentReference(relativePath) {
  if (typeof relativePath !== "string"
    || relativePath.includes("\\")
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)) {
    throw new TypeError("Attachment path must be relative");
  }

  const match = ATTACHMENT_PATH_PATTERN.exec(relativePath);
  if (!match || relativePath.includes("..")) {
    throw new TypeError("Attachment path is invalid");
  }

  return { directory: match[1], mediaKey: match[2].toLowerCase(), extension: match[3].toLowerCase() };
}

function resolveAttachmentReference(rootDirectory, relativePath) {
  if (typeof rootDirectory !== "string" || rootDirectory.trim().length === 0) {
    throw new TypeError("Attachment root directory is required");
  }

  parseAttachmentReference(relativePath);
  const root = path.resolve(rootDirectory);
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("Attachment path escapes its root directory");
  }
  return target;
}

module.exports = {
  ATTACHMENT_PATH_PATTERN,
  buildRelativeAttachmentPath,
  parseAttachmentReference,
  resolveAttachmentReference
};
