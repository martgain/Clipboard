const {
  MAX_IMAGE_BYTES,
  assertImageBytes,
  sha256Hex
} = require("../../shared/validation.cjs");

const DEFAULT_MAX_SEEN_SEQUENCES = 2048;
const FORMAT_ALIASES = new Map([
  ["text", "text"],
  ["text/plain", "text"],
  ["image", "image"],
  ["image/png", "image"],
  ["image/jpeg", "image"],
  ["image/jpg", "image"],
  ["text/html", "html"],
  ["html", "html"],
  ["text/rtf", "rtf"],
  ["application/rtf", "rtf"],
  ["rtf", "rtf"],
  ["bookmark", "bookmark"],
  ["text/uri-list", "bookmark"],
  ["file", "file"],
  ["files", "file"],
  ["application/x-moz-file", "file"]
]);
const RICH_FORMATS = new Set(["html", "rtf", "bookmark", "file"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

class ClipboardCaptureError extends Error {
  constructor(message, code = "CLIPBOARD_CAPTURE_FAILED") {
    super(message);
    this.name = "ClipboardCaptureError";
    this.code = code;
  }
}

function assertObject(candidateObject, label) {
  if (!candidateObject || typeof candidateObject !== "object" || Array.isArray(candidateObject)) {
    throw new TypeError(`${label} must be an object`);
  }

  return candidateObject;
}

function toBuffer(bytes, label = "Image bytes") {
  if (Buffer.isBuffer(bytes)) {
    return bytes;
  }

  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes);
  }

  if (bytes instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(bytes));
  }

  throw new TypeError(`${label} are required`);
}

function normalizeSequence(sequence) {
  if (sequence === undefined || sequence === null) {
    return null;
  }

  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new TypeError("Clipboard sequence must be a non-negative safe integer");
  }

  return sequence;
}

function normalizeCapturedAt(capturedAt, clock) {
  if (capturedAt === undefined || capturedAt === null) {
    return clock();
  }

  if (typeof capturedAt !== "string" || capturedAt.length === 0) {
    throw new TypeError("Clipboard capturedAt must be a non-empty string");
  }

  return capturedAt;
}

function normalizeSourceApp(sourceApp) {
  if (sourceApp === undefined || sourceApp === null) {
    return null;
  }

  assertObject(sourceApp, "sourceApp");

  const executable = sourceApp.executable ?? sourceApp.processName ?? sourceApp.name;
  if (executable !== undefined && (typeof executable !== "string" || executable.trim().length === 0)) {
    throw new TypeError("Clipboard source executable is invalid");
  }

  const pid = sourceApp.pid === undefined || sourceApp.pid === null ? null : sourceApp.pid;
  if (pid !== null && (!Number.isSafeInteger(pid) || pid < 0)) {
    throw new TypeError("Clipboard source pid is invalid");
  }

  if (!executable && pid === null) {
    return null;
  }

  return { executable: executable ? executable.trim() : "unknown", pid };
}

function normalizeRuleList(ruleSource, label) {
  if (ruleSource === undefined || ruleSource === null) {
    return [];
  }

  const candidateRules = Array.isArray(ruleSource) ? ruleSource : [ruleSource];
  candidateRules.forEach((rule) => {
    const executableRule = rule && typeof rule === "object" && !(rule instanceof RegExp)
      ? rule.executable
      : rule;
    if (typeof executableRule !== "string" && !(rule instanceof RegExp)) {
      throw new TypeError(`${label} rules must contain executable names or regular expressions`);
    }
  });
  return candidateRules.slice();
}

function normalizeRules(sourceRules = {}) {
  assertObject(sourceRules, "Clipboard source rules");
  return {
    allow: normalizeRuleList(sourceRules.allow, "Allow"),
    block: normalizeRuleList(sourceRules.block, "Block")
  };
}

function sourceName(sourceApp) {
  return sourceApp && typeof sourceApp.executable === "string"
    ? sourceApp.executable.toLowerCase()
    : null;
}

function matchesSourceRule(sourceApp, rule) {
  const executable = sourceName(sourceApp);
  if (!executable) {
    return false;
  }

  const candidate = rule && typeof rule === "object" && !(rule instanceof RegExp)
    ? rule.executable
    : rule;

  if (candidate instanceof RegExp) {
    candidate.lastIndex = 0;
    return candidate.test(executable);
  }

  if (typeof candidate !== "string") {
    return false;
  }

  const normalized = candidate.trim().toLowerCase();
  if (normalized === "*") {
    return true;
  }

  if (!normalized.includes("*")) {
    return normalized === executable;
  }

  const escaped = normalized.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(executable);
}

function isSourceAllowed(sourceApp, sourceRules) {
  if (sourceRules.block.some((rule) => matchesSourceRule(sourceApp, rule))) {
    return false;
  }

  return sourceRules.allow.length === 0
    || sourceRules.allow.some((rule) => matchesSourceRule(sourceApp, rule));
}

function canonicalFormat(formatCandidate) {
  if (typeof formatCandidate !== "string") {
    return null;
  }

  const normalized = formatCandidate.trim().toLowerCase();
  return FORMAT_ALIASES.get(normalized) || null;
}

function normalizeFormats(eventFormats, payload) {
  const formatCandidates = Array.isArray(eventFormats) ? eventFormats.slice() : [];
  if (payload && typeof payload.kind === "string") {
    formatCandidates.unshift(payload.kind);
  }

  const formats = [];
  for (const formatCandidate of formatCandidates) {
    const format = canonicalFormat(formatCandidate);
    if (format && !formats.includes(format)) {
      formats.push(format);
    }
  }

  return formats;
}

function metadataForString(format, mimeType, richText) {
  return {
    format,
    mimeType,
    size: Buffer.byteLength(richText, "utf8"),
    sha256: sha256Hex(Buffer.from(richText, "utf8"))
  };
}

function sanitizeRichTextMetadata(format, richText) {
  if (typeof richText === "string") {
    return metadataForString(format, format === "html" ? "text/html" : "text/rtf", richText);
  }
  return { format, available: true };
}

function sanitizeBookmarkMetadata(bookmark) {
  if (bookmark && typeof bookmark === "object") {
    const metadata = { format: "bookmark" };
    if (typeof bookmark.title === "string") {
      metadata.title = bookmark.title;
    }
    if (typeof bookmark.url === "string") {
      metadata.url = bookmark.url;
    }
    return metadata;
  }
  return { format: "bookmark", available: true };
}

function sanitizeFileMetadata(filePayload) {
  if (filePayload && typeof filePayload === "object") {
    const metadata = { format: "file" };
    if (typeof filePayload.name === "string") {
      metadata.name = filePayload.name;
    }
    if (typeof filePayload.mimeType === "string") {
      metadata.mimeType = filePayload.mimeType;
    }
    if (Number.isSafeInteger(filePayload.size) && filePayload.size >= 0) {
      metadata.size = filePayload.size;
    } else if (filePayload.bytes !== undefined) {
      const bytes = toBuffer(filePayload.bytes, "File bytes");
      metadata.size = bytes.length;
      metadata.sha256 = sha256Hex(bytes);
    }
    return metadata;
  }
  return { format: "file", available: true };
}

function sanitizeGenericMetadata(format, richPayload) {
  if (richPayload && typeof richPayload === "object" && !Array.isArray(richPayload)) {
    const metadata = { format };
    for (const property of ["mimeType", "name", "title", "url"]) {
      if (typeof richPayload[property] === "string") {
        metadata[property] = richPayload[property];
      }
    }
    if (Number.isSafeInteger(richPayload.size) && richPayload.size >= 0) {
      metadata.size = richPayload.size;
    }
    if (typeof richPayload.sha256 === "string" && SHA256_PATTERN.test(richPayload.sha256)) {
      metadata.sha256 = richPayload.sha256.toLowerCase();
    }
    return metadata;
  }

  if (typeof richPayload === "string") {
    return { format, size: Buffer.byteLength(richPayload, "utf8") };
  }

  return { format, available: true };
}

function sanitizeRichMetadata(format, richPayload) {
  if (format === "html" || format === "rtf") {
    return sanitizeRichTextMetadata(format, richPayload);
  }
  if (format === "bookmark") {
    return sanitizeBookmarkMetadata(richPayload);
  }
  if (format === "file") {
    return sanitizeFileMetadata(richPayload);
  }
  return sanitizeGenericMetadata(format, richPayload);
}

function suppliedMetadataByFormat(richFormats) {
  const entries = Array.isArray(richFormats) ? richFormats : [];
  return new Map(entries
    .filter((richEntry) => richEntry && typeof richEntry === "object")
    .map((richEntry) => [canonicalFormat(richEntry.format || richEntry.type), richEntry]));
}

function richPayloads(event, payload) {
  return {
    html: payload.html ?? event.html,
    rtf: payload.rtf ?? event.rtf,
    bookmark: payload.bookmark ?? event.bookmark,
    file: payload.files ?? payload.file ?? event.files ?? event.file
  };
}

function appendFileMetadata(metadata, filePayloads) {
  if (!Array.isArray(filePayloads)) {
    return false;
  }
  filePayloads.forEach((filePayload) => metadata.push(sanitizeRichMetadata("file", filePayload)));
  return true;
}

function normalizeRichMetadata(event, payload, formats) {
  const metadata = [];
  const suppliedByFormat = suppliedMetadataByFormat(event.richFormats);
  const payloadByFormat = richPayloads(event, payload);

  for (const format of formats) {
    if (!RICH_FORMATS.has(format)) {
      continue;
    }

    if (format === "file" && appendFileMetadata(metadata, payloadByFormat.file)) {
      continue;
    }

    const richPayload = payloadByFormat[format] ?? suppliedByFormat.get(format);
    metadata.push(sanitizeRichMetadata(format, richPayload));
  }

  return metadata;
}

function imageFingerprint(image) {
  return `image:${image.sha256}:${image.size}:${image.mimeType}`;
}

function payloadFingerprint(payload) {
  if (payload.kind === "text") {
    return `text:${sha256Hex(Buffer.from(payload.text, "utf8"))}`;
  }

  return imageFingerprint(payload);
}

function rememberBounded(set, value, limit) {
  set.add(value);
  while (set.size > limit) {
    const oldest = set.values().next().value;
    set.delete(oldest);
  }
}

function safeError(error) {
  return {
    code: typeof error?.code === "string" ? error.code : "ERROR",
    message: typeof error?.message === "string" ? error.message : String(error)
  };
}

function validateStoredImage(storedImage, expectedSha256, expectedSize) {
  assertObject(storedImage, "Clipboard media result");
  const storedHash = storedImage.sha256 ?? storedImage.hash;
  if (storedHash !== undefined && storedHash !== expectedSha256) {
    throw new ClipboardCaptureError("Clipboard media store returned a different SHA-256", "MEDIA_HASH_MISMATCH");
  }
  if (storedImage.size !== undefined && storedImage.size !== expectedSize) {
    throw new ClipboardCaptureError("Clipboard media store returned a different size", "MEDIA_SIZE_MISMATCH");
  }
}

function validateImageDeclarations(imagePayload, rawPayload, actualSha256, actualSize) {
  const declaredSize = imagePayload.size ?? rawPayload.size;
  const declaredHash = imagePayload.sha256 ?? imagePayload.hash ?? rawPayload.sha256 ?? rawPayload.hash;

  if (declaredSize !== undefined && declaredSize !== actualSize) {
    throw new RangeError("Clipboard image size does not match its bytes");
  }
  if (declaredHash !== undefined && (typeof declaredHash !== "string" || !SHA256_PATTERN.test(declaredHash)
    || declaredHash.toLowerCase() !== actualSha256)) {
    throw new TypeError("Clipboard image SHA-256 does not match its bytes");
  }
}

function validateServiceDependencies(adapter, mediaStore) {
  if (adapter !== null && (!adapter || typeof adapter !== "object")) {
    throw new TypeError("Clipboard adapter must be an object");
  }
  if (mediaStore !== null && (!mediaStore || typeof mediaStore.write !== "function")) {
    throw new TypeError("Clipboard media store must expose write(bytes, mimeType)");
  }
}

function validateServiceLimits(maxImageBytes, maxSeenSequences) {
  if (!Number.isSafeInteger(maxImageBytes) || maxImageBytes < 1) {
    throw new RangeError("Clipboard image byte limit is invalid");
  }
  if (!Number.isSafeInteger(maxSeenSequences) || maxSeenSequences < 1) {
    throw new RangeError("Clipboard sequence cache limit is invalid");
  }
}

function validateServiceCallbacks(clock, onChange) {
  if (typeof clock !== "function") {
    throw new TypeError("Clipboard clock must be a function");
  }
  if (onChange !== null && typeof onChange !== "function") {
    throw new TypeError("Clipboard onChange must be a function");
  }
}

class ClipboardService {
  constructor({
    adapter = null,
    mediaStore = null,
    sourceRules = {},
    maxImageBytes = MAX_IMAGE_BYTES,
    maxSeenSequences = DEFAULT_MAX_SEEN_SEQUENCES,
    clock = () => new Date().toISOString(),
    onChange = null
  } = {}) {
    validateServiceDependencies(adapter, mediaStore);
    validateServiceLimits(maxImageBytes, maxSeenSequences);
    validateServiceCallbacks(clock, onChange);

    this.adapter = adapter;
    this.mediaStore = mediaStore;
    this.maxImageBytes = maxImageBytes;
    this.maxSeenSequences = maxSeenSequences;
    this.clock = clock;
    this.sourceRules = normalizeRules(sourceRules);
    this.paused = false;
    this.highestSequence = -1;
    this.seenSequences = new Set();
    this.seenFingerprints = new Set();
    this.listeners = new Set();
    this.lastError = null;

    if (onChange) {
      this.listeners.add(onChange);
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  setPaused(paused) {
    if (typeof paused !== "boolean") {
      throw new TypeError("Clipboard pause state must be boolean");
    }
    this.paused = paused;
  }

  isPaused() {
    return this.paused;
  }

  setSourceRules(sourceRules) {
    this.sourceRules = normalizeRules(sourceRules);
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Clipboard listener must be a function");
    }
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  resetDedupe() {
    this.highestSequence = -1;
    this.seenSequences.clear();
    this.seenFingerprints.clear();
  }

  getStatus() {
    return {
      paused: this.paused,
      highestSequence: this.highestSequence,
      seenSequenceCount: this.seenSequences.size,
      lastError: this.lastError
    };
  }

  _sequenceWasSeen(sequence) {
    if (sequence === null) {
      return false;
    }

    return this.seenSequences.has(sequence) || sequence <= this.highestSequence;
  }

  _rememberSequence(sequence) {
    if (sequence === null) {
      return;
    }

    rememberBounded(this.seenSequences, sequence, this.maxSeenSequences);
    this.highestSequence = Math.max(this.highestSequence, sequence);
  }

  _rejectCapture(reason, sequence) {
    this._rememberSequence(sequence);
    return { accepted: false, reason };
  }

  _captureEligibility(originalEvent, sequence) {
    if (this._sequenceWasSeen(sequence)) {
      return { rejected: true, result: { accepted: false, reason: "duplicate-sequence" } };
    }
    if (this.paused) {
      return { rejected: true, result: this._rejectCapture("paused", sequence) };
    }

    const sourceApp = normalizeSourceApp(originalEvent.sourceApp);
    if (!isSourceAllowed(sourceApp, this.sourceRules)) {
      return { rejected: true, result: this._rejectCapture("source-blocked", sequence) };
    }
    return { rejected: false, sourceApp };
  }

  async _resolveEventPayload(event) {
    if (event.payload !== undefined) {
      return { event, payload: assertObject(event.payload, "Clipboard payload") };
    }

    if (!this.adapter || typeof this.adapter.readSnapshot !== "function") {
      throw new ClipboardCaptureError("Clipboard payload is missing and no adapter can read it", "PAYLOAD_UNAVAILABLE");
    }

    const snapshot = await this.adapter.readSnapshot({
      formats: event.formats,
      sequence: event.sequence,
      capturedAt: event.capturedAt,
      sourceApp: event.sourceApp
    });
    assertObject(snapshot, "Clipboard snapshot");

    return {
      event: { ...event, ...snapshot },
      payload: assertObject(snapshot.payload, "Clipboard payload")
    };
  }

  _normalizeTextPayload(payload) {
    if (typeof payload.text !== "string") {
      throw new TypeError("Clipboard text must be a string");
    }
    return { kind: "text", text: payload.text };
  }

  async _normalizeImagePayload(rawPayload) {
    const imagePayload = rawPayload.image && typeof rawPayload.image === "object" ? rawPayload.image : rawPayload;
    const mimeType = typeof imagePayload.mimeType === "string"
      ? imagePayload.mimeType.trim().toLowerCase()
      : imagePayload.type;
    const imageBytes = assertImageBytes(toBuffer(imagePayload.bytes), mimeType, this.maxImageBytes);
    const actualSha256 = sha256Hex(imageBytes);
    validateImageDeclarations(imagePayload, rawPayload, actualSha256, imageBytes.length);
    const storedImage = await this._storeImage(imageBytes, mimeType, actualSha256);

    return {
      kind: "image",
      mimeType,
      sha256: actualSha256,
      size: imageBytes.length,
      ...(storedImage && typeof storedImage.mediaKey === "string" ? { mediaKey: storedImage.mediaKey } : {})
    };
  }

  async _storeImage(imageBytes, mimeType, expectedSha256) {
    if (!this.mediaStore) {
      return null;
    }
    const storedImage = await this.mediaStore.write(imageBytes, mimeType);
    validateStoredImage(storedImage, expectedSha256, imageBytes.length);
    return storedImage;
  }

  async _normalizePayload(rawPayload) {
    const payloadKind = canonicalFormat(rawPayload.kind || rawPayload.type);
    if (payloadKind === "text") {
      return this._normalizeTextPayload(rawPayload);
    }
    if (payloadKind === "image") {
      return this._normalizeImagePayload(rawPayload);
    }
    throw new TypeError("Unsupported clipboard payload kind");
  }

  async _notify(event) {
    for (const listener of this.listeners) {
      try {
        await listener(event);
      } catch (error) {
        this.lastError = safeError(error);
      }
    }
  }

  _buildSafeEvent({ sequence, resolvedEvent, sourceApp, payload, normalizedPayload }) {
    const formats = normalizeFormats(resolvedEvent.formats, payload);
    const safeEvent = {
      sequence: sequence === null ? undefined : sequence,
      capturedAt: normalizeCapturedAt(resolvedEvent.capturedAt, this.clock),
      sourceApp,
      formats,
      payload: normalizedPayload,
      richFormats: normalizeRichMetadata(resolvedEvent, payload, formats)
    };
    if (safeEvent.sequence === undefined) {
      delete safeEvent.sequence;
    }
    return safeEvent;
  }

  async _acceptCapture({ sequence, resolvedEvent, sourceApp, payload, normalizedPayload, fingerprint }) {
    this._rememberSequence(sequence);
    rememberBounded(this.seenFingerprints, fingerprint, this.maxSeenSequences);
    const safeEvent = this._buildSafeEvent({ sequence, resolvedEvent, sourceApp, payload, normalizedPayload });
    await this._notify(safeEvent);
    return { accepted: true, event: safeEvent };
  }

  async capture(inputEvent) {
    const originalEvent = assertObject(inputEvent, "Clipboard event");
    const sequence = normalizeSequence(originalEvent.sequence);
    const eligibility = this._captureEligibility(originalEvent, sequence);
    if (eligibility.rejected) {
      return eligibility.result;
    }

    const { event: resolvedEvent, payload } = await this._resolveEventPayload({
      ...originalEvent,
      sourceApp: eligibility.sourceApp
    });
    const normalizedPayload = await this._normalizePayload(payload);
    const fingerprint = payloadFingerprint(normalizedPayload);

    if (this.seenFingerprints.has(fingerprint)) {
      return this._rejectCapture("duplicate-content", sequence);
    }

    return this._acceptCapture({
      sequence,
      resolvedEvent,
      sourceApp: eligibility.sourceApp,
      payload,
      normalizedPayload,
      fingerprint
    });
  }
}

module.exports = Object.freeze({
  ClipboardCaptureError,
  ClipboardService,
  DEFAULT_MAX_SEEN_SEQUENCES,
  isSourceAllowed,
  matchesSourceRule,
  normalizeFormats,
  normalizeRichMetadata,
  normalizeSourceApp,
  sanitizeRichMetadata
});
