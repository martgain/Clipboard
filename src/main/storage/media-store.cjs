const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_IMAGE_BYTES,
  assertImageBytes,
  hasImageMagic,
  sha256Hex
} = require("../../shared/validation.cjs");
const { buildRelativeAttachmentPath, resolveAttachmentReference } = require("../../../attachment-paths.cjs");

const DEFAULT_MAX_BYTES = MAX_IMAGE_BYTES;
const MEDIA_KEY_PATTERN = /^[a-f0-9]{64}$/;
const MEDIA_FILE_PATTERN = /^([a-f0-9]{64})\.media$/;
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/svg+xml"
]);
const hashBytes = sha256Hex;

function normalizeMimeType(mimeType) {
  if (typeof mimeType !== "string") {
    throw new TypeError("Image MIME type is required");
  }

  const normalized = mimeType.trim().toLowerCase() === "image/jpg" ? "image/jpeg" : mimeType.trim().toLowerCase();
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(normalized)) {
    throw new TypeError(`Unsupported image MIME type: ${mimeType}`);
  }

  return normalized;
}

function assertMediaKey(mediaKey) {
  if (typeof mediaKey !== "string" || !MEDIA_KEY_PATTERN.test(mediaKey)) {
    throw new TypeError("Invalid media key");
  }
}

function normalizeExpectedHash(value) {
  if (typeof value !== "string" || !MEDIA_KEY_PATTERN.test(value.toLowerCase())) {
    return null;
  }

  return value.toLowerCase();
}

function detectMimeType(bytes) {
  return [...SUPPORTED_IMAGE_MIME_TYPES].find((mimeType) => hasImageMagic(bytes, mimeType)) || null;
}

function normalizeReferences(referencedKeys) {
  if (referencedKeys === undefined || referencedKeys === null) {
    return new Set();
  }

  const values = typeof referencedKeys === "string" ? [referencedKeys] : referencedKeys;
  if (!values || typeof values[Symbol.iterator] !== "function") {
    throw new TypeError("Referenced media keys must be iterable");
  }

  return new Set([...values]
    .filter((value) => typeof value === "string")
    .map((value) => MEDIA_KEY_PATTERN.test(value) ? value.toLowerCase() : value));
}

function normalizeReconcileOptions(options) {
  if (options === undefined || options === null) {
    return { graceMs: 0, now: Date.now(), dryRun: false };
  }

  if (typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Reconcile options must be an object");
  }

  const graceMs = options.graceMs === undefined ? 0 : options.graceMs;
  const rawNow = options.now === undefined ? Date.now() : options.now;
  const now = rawNow instanceof Date ? rawNow.getTime() : rawNow;

  if (!Number.isFinite(graceMs) || graceMs < 0) {
    throw new RangeError("Reconcile grace period must be a non-negative number");
  }

  if (!Number.isFinite(now) || now < 0) {
    throw new RangeError("Reconcile time must be a non-negative number");
  }

  return { graceMs, now, dryRun: options.dryRun === true };
}

function flushDirectory(directory) {
  let directoryHandle;

  try {
    directoryHandle = fs.openSync(directory, "r");
    fs.fsyncSync(directoryHandle);
  } catch (error) {
    if (!new Set(["EINVAL", "EISDIR", "ENOTSUP", "EPERM"]).has(error.code)) {
      throw error;
    }
  } finally {
    if (directoryHandle !== undefined) {
      fs.closeSync(directoryHandle);
    }
  }
}

function assertExistingMediaMatches(target, expectedBytes, expectedHash) {
  const existingBytes = fs.readFileSync(target);

  if (hashBytes(existingBytes) !== expectedHash || !existingBytes.equals(expectedBytes)) {
    throw new Error("Existing media failed content-address integrity check");
  }
}

function writeNewMediaFile(mediaDirectory, target, mediaKey, mediaBytes) {
  const temporaryFile = path.join(
    mediaDirectory,
    `.${mediaKey}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  let fileHandle;

  try {
    fileHandle = fs.openSync(temporaryFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
    fs.writeFileSync(fileHandle, mediaBytes);
    fs.fsyncSync(fileHandle);
    fs.closeSync(fileHandle);
    fileHandle = undefined;

    try {
      fs.renameSync(temporaryFile, target);
    } catch (error) {
      if (!fs.existsSync(target)) {
        throw error;
      }

      assertExistingMediaMatches(target, mediaBytes, mediaKey);
    }

    flushDirectory(mediaDirectory);
  } finally {
    if (fileHandle !== undefined) {
      fs.closeSync(fileHandle);
    }
    fs.rmSync(temporaryFile, { force: true });
  }
}

function mediaWriteResult(mediaKey, sha256, size, mimeType, mediaPath) {
  return { mediaKey, sha256, size, mimeType, path: mediaPath };
}

function expectedMediaMatches(bytes, mediaKey, expected) {
  if (typeof expected === "string") {
    return normalizeExpectedHash(expected) === mediaKey;
  }

  if (typeof expected !== "object" || Array.isArray(expected)) {
    return false;
  }

  const expectedHash = expected.sha256 ?? expected.hash;
  if (expectedHash !== undefined && normalizeExpectedHash(expectedHash) !== mediaKey) {
    return false;
  }

  if (expected.mediaKey !== undefined && expected.mediaKey !== mediaKey) {
    return false;
  }

  if (expected.size !== undefined && expected.size !== bytes.length) {
    return false;
  }

  return expected.mimeType === undefined || normalizeMimeType(expected.mimeType) === detectMimeType(bytes);
}

function reconcileMediaFile(mediaKey, target, references, now, graceMs, dryRun) {
  if (references.has(mediaKey)) {
    return "kept";
  }

  let stats;
  try {
    stats = fs.statSync(target);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }

  if (!stats.isFile() || stats.mtimeMs + graceMs > now) {
    return stats.isFile() ? "deferred" : null;
  }

  if (dryRun) {
    return "wouldRemove";
  }

  try {
    fs.unlinkSync(target);
    return "removed";
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

class MediaStore {
  constructor({ mediaDirectory, maxBytes = DEFAULT_MAX_BYTES } = {}) {
    if (typeof mediaDirectory !== "string" || mediaDirectory.trim().length === 0) {
      throw new TypeError("Media directory is required");
    }

    if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("Media byte limit must be a positive safe integer");
    }

    this.mediaDirectory = path.resolve(mediaDirectory);
    this.maxBytes = maxBytes;
  }

  mediaPath(mediaKey) {
    assertMediaKey(mediaKey);
    return path.join(this.mediaDirectory, `${mediaKey}.media`);
  }

  relativePath(mediaKey) {
    return buildRelativeAttachmentPath(mediaKey);
  }

  resolveReference(rootDirectory, relativePath) {
    return resolveAttachmentReference(rootDirectory, relativePath);
  }

  write(bytes, mimeType) {
    const normalizedMimeType = normalizeMimeType(mimeType);
    const mediaBytes = assertImageBytes(bytes, normalizedMimeType, this.maxBytes);

    const sha256 = hashBytes(mediaBytes);
    const mediaKey = sha256;
    const target = this.mediaPath(mediaKey);
    fs.mkdirSync(this.mediaDirectory, { recursive: true });

    if (fs.existsSync(target)) {
      assertExistingMediaMatches(target, mediaBytes, sha256);
      return mediaWriteResult(mediaKey, sha256, mediaBytes.length, normalizedMimeType, target);
    }

    writeNewMediaFile(this.mediaDirectory, target, mediaKey, mediaBytes);
    return mediaWriteResult(mediaKey, sha256, mediaBytes.length, normalizedMimeType, target);
  }

  read(mediaKey) {
    const target = this.mediaPath(mediaKey);

    try {
      return fs.readFileSync(target);
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  verify(mediaKey, expected = undefined) {
    const bytes = this.read(mediaKey);
    if (bytes === null) {
      return false;
    }

    const actualHash = hashBytes(bytes);
    if (actualHash !== mediaKey) {
      return false;
    }

    return expected === undefined || expected === null || expectedMediaMatches(bytes, actualHash, expected);
  }

  readDataUrl(mediaKey) {
    const bytes = this.read(mediaKey);

    if (bytes === null) {
      return null;
    }

    const mimeType = detectMimeType(bytes);

    if (!mimeType) {
      return null;
    }

    return `data:${mimeType};base64,${bytes.toString("base64")}`;
  }

  reconcile(referencedKeys, options = undefined) {
    const references = normalizeReferences(referencedKeys);
    const { graceMs, now, dryRun } = normalizeReconcileOptions(options);
    const reconciliation = { removed: [], kept: [], deferred: [], wouldRemove: [] };

    if (!fs.existsSync(this.mediaDirectory)) {
      return result;
    }

    for (const name of fs.readdirSync(this.mediaDirectory).sort()) {
      const match = MEDIA_FILE_PATTERN.exec(name);
      if (!match) {
        continue;
      }

      const mediaKey = match[1];
      const target = path.join(this.mediaDirectory, name);
      const action = reconcileMediaFile(mediaKey, target, references, now, graceMs, dryRun);

      if (action) {
        reconciliation[action].push(mediaKey);
      }
    }

    return reconciliation;
  }
}

module.exports = { DEFAULT_MAX_BYTES, MediaStore, detectMimeType, normalizeMimeType };
