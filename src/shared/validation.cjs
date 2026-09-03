const crypto = require("node:crypto");

const MAX_NORMAL_ENTRIES = 150;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_COLLECTION_RECORDS = 100;
const MAX_QUERY_TEXT_LENGTH = 5000;
const MAX_QUERY_LIST_VALUES = 20;
const MAX_ENTRY_NOTE_LENGTH = 10000;
const MAX_ENTRY_TITLE_LENGTH = 200;
const MAX_ENTRY_DOMAIN_LENGTH = 253;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const IMAGE_MIME_PATTERN = /^image\/[a-z0-9.+-]+$/i;
const SAFE_TITLE_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const SAFE_DOMAIN_PATTERN = /^[^\s/?#@]+$/;
const SUPPORTED_COLLECTION_TYPES = new Set(["text", "image", "file", "bookmark"]);

function assertSafeIdentifier(value, label = "identifier") {
  if (typeof value !== "string" || !SAFE_IDENTIFIER_PATTERN.test(value) || value.includes("..")) {
    throw new TypeError(label + " is invalid");
  }
}

function assertValidTimestamp(value, label = "timestamp") {
  if (value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(label + " is invalid");
  }
}

function assertImageMimeType(mimeType) {
  if (typeof mimeType !== "string" || !IMAGE_MIME_PATTERN.test(mimeType)) {
    throw new TypeError("Image MIME type is invalid");
  }
}

function assertSafeTitle(value, label = "title") {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_ENTRY_TITLE_LENGTH || SAFE_TITLE_CONTROL_PATTERN.test(value)) {
    throw new TypeError(label + " is invalid");
  }
}

function assertEntryNote(value, label = "entry note") {
  if (typeof value !== "string" || value.length > MAX_ENTRY_NOTE_LENGTH || /[\u0000\u007f]/.test(value)) {
    throw new TypeError(label + " is invalid");
  }
}

function assertEntryTitle(value, label = "entry title") {
  assertSafeTitle(value, label);
}

function assertEntryDomain(value, label = "entry domain") {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENTRY_DOMAIN_LENGTH
    || value !== value.trim() || !SAFE_DOMAIN_PATTERN.test(value)) {
    throw new TypeError(label + " is invalid");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(`https://${value}`);
  } catch (error) {
    throw new TypeError(label + " is invalid");
  }

  if (!parsedUrl.hostname || parsedUrl.hostname !== value.toLowerCase() || parsedUrl.port
    || parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
    throw new TypeError(label + " is invalid");
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

  throw new TypeError("Image bytes are required");
}

function hasImageMagic(bytes, mimeType) {
  const normalizedMimeType = mimeType.toLowerCase();

  if (normalizedMimeType === "image/png") {
    return bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  }

  if (normalizedMimeType === "image/jpeg" || normalizedMimeType === "image/jpg") {
    return bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  }

  if (normalizedMimeType === "image/gif") {
    return bytes.subarray(0, 6).toString("ascii") === "GIF87a"
      || bytes.subarray(0, 6).toString("ascii") === "GIF89a";
  }

  if (normalizedMimeType === "image/webp") {
    return bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  }

  if (normalizedMimeType === "image/bmp") {
    return bytes.subarray(0, 2).toString("ascii") === "BM";
  }

  if (normalizedMimeType === "image/tiff") {
    return (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
      || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a);
  }

  if (normalizedMimeType === "image/x-icon" || normalizedMimeType === "image/vnd.microsoft.icon") {
    return bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00;
  }

  if (normalizedMimeType === "image/svg+xml") {
    return /<svg(?:\s|>)/i.test(bytes.toString("utf8", 0, Math.min(bytes.length, 4096)).replace(/^\uFEFF/, "").trimStart());
  }

  return false;
}

function assertImageBytes(bytes, mimeType, maxBytes = MAX_IMAGE_BYTES) {
  const buffer = toBuffer(bytes);
  assertImageMimeType(mimeType);

  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError("Image byte limit is invalid");
  }

  if (buffer.length === 0) {
    throw new TypeError("Image bytes are empty");
  }

  if (buffer.length > maxBytes) {
    throw new RangeError("Image bytes are too large");
  }

  if (!hasImageMagic(buffer, mimeType)) {
    throw new TypeError("Image bytes do not match the MIME type");
  }

  return buffer;
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(toBuffer(bytes)).digest("hex");
}

function assertEntryMetadata(entry, seenIds) {
  assertSafeIdentifier(entry.id, "entry id");
  if (seenIds.has(entry.id)) {
    throw new TypeError("Duplicate entry id");
  }
  seenIds.add(entry.id);
  assertValidTimestamp(entry.createdAt, "createdAt");
  assertValidTimestamp(entry.updatedAt, "updatedAt");
}

function assertEntryTags(entry) {
  if (entry.tags !== undefined && (!Array.isArray(entry.tags)
    || entry.tags.length > 20
    || entry.tags.some((tag) => typeof tag !== "string" || tag.trim().length === 0 || tag.trim().length > 30))) {
    throw new TypeError("Entry tags are invalid");
  }
}

function assertEntryMetadataFields(entry) {
  if (entry.note !== undefined) {
    assertEntryNote(entry.note);
  }
  if (entry.title !== undefined) {
    assertEntryTitle(entry.title);
  }
  if (entry.domain !== undefined) {
    assertEntryDomain(entry.domain);
  }
}

function assertTextEntry(entry) {
  if (typeof entry.text !== "string" || entry.text.trim().length === 0) {
    throw new TypeError("Text entry is invalid");
  }
}

function assertImageEntry(entry) {
  if (!entry.image || typeof entry.image !== "object") {
    throw new TypeError("Library image entry is invalid");
  }
  assertSafeIdentifier(entry.image.blobKey, "media key");
  assertImageMimeType(entry.image.mimeType);
  if (!Number.isInteger(entry.image.size) || entry.image.size < 0 || entry.image.size > MAX_IMAGE_BYTES) {
    throw new RangeError("Image metadata size is invalid");
  }
  if (typeof entry.image.hash !== "string" || !/^[a-f0-9]{8}(?:[a-f0-9]{56})?$/i.test(entry.image.hash)) {
    throw new TypeError("Image metadata hash is invalid");
  }
}

function assertValidEntry(entry, seenIds) {
  if (!entry || typeof entry !== "object") {
    throw new TypeError("Library entry is invalid");
  }

  assertEntryMetadata(entry, seenIds);
  assertEntryTags(entry);
  assertEntryMetadataFields(entry);

  if (entry.type === "text") {
    assertTextEntry(entry);
    return;
  }

  if (entry.type !== "image") {
    throw new TypeError("Library entry type is invalid");
  }

  assertImageEntry(entry);
}

function assertCollectionQueryList(values, label) {
  if (!Array.isArray(values) || values.length > MAX_QUERY_LIST_VALUES || values.some((value) => typeof value !== "string" || value.trim().length === 0)) {
    throw new TypeError(label + " is invalid");
  }
}

function assertCollectionTypeFilter(typeValue) {
  if (SUPPORTED_COLLECTION_TYPES.has(typeValue)) {
    return;
  }

  if (Array.isArray(typeValue) && typeValue.length > 0 && typeValue.every((value) => SUPPORTED_COLLECTION_TYPES.has(value))) {
    return;
  }

  throw new TypeError("Collection query type is invalid");
}

function assertCollectionDateFilter(value, label) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return;
  }

  if (typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value))) {
    return;
  }

  throw new TypeError(label + " is invalid");
}

function assertSmartCollection(collection) {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new TypeError("Smart collection is invalid");
  }

  assertSafeIdentifier(collection.id, "collection id");
  assertSafeTitle(collection.title, "collection title");
  if (collection.kind !== "smart") {
    throw new TypeError("Smart collection kind is invalid");
  }
  if (Object.hasOwn(collection, "items") || Object.hasOwn(collection, "entry")) {
    throw new TypeError("Smart collections must store a query only");
  }

  const query = collection.query;
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    throw new TypeError("Smart collection query is invalid");
  }
  if (query.text !== undefined && (typeof query.text !== "string" || query.text.length > MAX_QUERY_TEXT_LENGTH)) {
    throw new TypeError("Smart collection query text is invalid");
  }
  if (query.type !== undefined) {
    assertCollectionTypeFilter(query.type);
  }
  if (query.tags !== undefined) {
    assertCollectionQueryList(query.tags, "Collection query tags");
  }
  if (query.sourceApps !== undefined) {
    assertCollectionQueryList(query.sourceApps, "Collection query source apps");
  }
  if (query.tagMode !== undefined && query.tagMode !== "any") {
    throw new TypeError("Collection query tag mode is invalid");
  }
  if (query.dateFrom !== undefined) {
    assertCollectionDateFilter(query.dateFrom, "Collection query dateFrom");
  }
  if (query.dateTo !== undefined) {
    assertCollectionDateFilter(query.dateTo, "Collection query dateTo");
  }
}

function assertTrashRecord(record, seenRecordIds, seenEntryIds) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new TypeError("Trash record is invalid");
  }

  assertSafeIdentifier(record.id, "trash record id");
  if (seenRecordIds.has(record.id)) {
    throw new TypeError("Duplicate trash record id");
  }
  seenRecordIds.add(record.id);

  if (record.originalList !== "normal" && record.originalList !== "pinned") {
    throw new TypeError("Trash originalList is invalid");
  }
  if (record.deletedAt === undefined) {
    throw new TypeError("deletedAt is required");
  }
  assertValidTimestamp(record.deletedAt, "deletedAt");
  assertValidEntry(record.entry, seenEntryIds);
}

function assertPersistableLibrary(library, { normalLimit = MAX_NORMAL_ENTRIES } = {}) {
  if (!library || typeof library !== "object" || library.schemaVersion !== 2) {
    throw new TypeError("Unsupported library schema");
  }

  if (!Array.isArray(library.pinned) || !Array.isArray(library.normal)) {
    throw new TypeError("Library entry lists are required");
  }

  const smartCollections = Array.isArray(library.smartCollections) ? library.smartCollections : [];
  const trash = Array.isArray(library.trash) ? library.trash : [];

  if (!Number.isInteger(normalLimit) || normalLimit < 0 || library.normal.length > normalLimit) {
    throw new RangeError("Normal library limit is " + normalLimit);
  }

  if (smartCollections.length > MAX_COLLECTION_RECORDS) {
    throw new RangeError("Smart collection limit is " + MAX_COLLECTION_RECORDS);
  }

  const seenEntryIds = new Set();
  [...library.pinned, ...library.normal].forEach((entry) => assertValidEntry(entry, seenEntryIds));
  smartCollections.forEach(assertSmartCollection);
  const seenTrashRecordIds = new Set();
  trash.forEach((record) => assertTrashRecord(record, seenTrashRecordIds, seenEntryIds));
  return library;
}

module.exports = Object.freeze({
  IMAGE_MIME_PATTERN,
  MAX_ENTRY_DOMAIN_LENGTH,
  MAX_ENTRY_NOTE_LENGTH,
  MAX_ENTRY_TITLE_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_NORMAL_ENTRIES,
  assertImageBytes,
  assertImageMimeType,
  assertEntryDomain,
  assertEntryNote,
  assertEntryTags,
  assertEntryTitle,
  assertPersistableLibrary,
  assertSafeIdentifier,
  assertSafeTitle,
  assertSmartCollection,
  assertValidEntry,
  assertValidTimestamp,
  hasImageMagic,
  sha256Hex
});
