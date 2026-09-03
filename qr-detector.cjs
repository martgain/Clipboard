const MAX_PAYLOAD_LENGTH = 4096;
const MAX_CODE_RESULTS = 32;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/u;

function createCodeResult(status) {
  return { status, qr: [], barcodes: [], links: [] };
}

function isByteArray(imageBytes) {
  return Buffer.isBuffer(imageBytes) || imageBytes instanceof Uint8Array;
}

function detectCodes(imageBytes, options = {}) {
  if (!isByteArray(imageBytes)) {
    throw new TypeError("Code detection image must be a byte array");
  }
  if (imageBytes.length === 0) {
    return createCodeResult("invalid");
  }
  if (options?.protected === true) {
    return createCodeResult("protected");
  }

  const decoder = resolveDecoder(options);
  if (!decoder) {
    return createCodeResult("unsupported");
  }

  const decoded = decoder(Buffer.from(imageBytes));
  return normalizeDecoderResult(decoded);
}

function resolveDecoder(options) {
  if (typeof options?.decoder === "function") {
    return options.decoder;
  }
  if (typeof options?.decoder?.detect === "function") {
    return options.decoder.detect.bind(options.decoder);
  }
  return null;
}

function normalizeDecoderResult(decoded) {
  const qr = normalizeCodeEntries(decoded?.qr);
  const barcodes = normalizeCodeEntries(decoded?.barcodes);
  const links = collectLinks([
    ...qr,
    ...barcodes,
    ...(Array.isArray(decoded?.links) ? decoded.links : [])
  ]);

  return { status: "ok", qr, barcodes, links };
}

function normalizeCodeEntries(rawCodes) {
  if (!Array.isArray(rawCodes)) {
    return [];
  }

  const entries = [];
  const seenPayloads = new Set();
  for (const rawCode of rawCodes) {
    if (entries.length >= MAX_CODE_RESULTS) {
      break;
    }
    const entry = normalizeCodeEntry(rawCode);
    if (entry && !seenPayloads.has(entry.payload)) {
      entries.push(entry);
      seenPayloads.add(entry.payload);
    }
  }
  return entries;
}

function normalizeCodeEntry(rawCode) {
  const payload = extractPayload(rawCode);
  if (!isSafePayload(payload)) {
    return null;
  }

  const confidence = normalizeConfidence(rawCode?.confidence);
  return confidence === null ? { payload } : { payload, confidence };
}

function extractPayload(rawCode) {
  if (typeof rawCode === "string") {
    return rawCode.trim();
  }
  if (!rawCode || typeof rawCode !== "object") {
    return null;
  }

  for (const fieldName of ["payload", "data", "text", "rawValue"]) {
    if (typeof rawCode[fieldName] === "string") {
      return rawCode[fieldName].trim();
    }
  }
  return null;
}

function isSafePayload(payload) {
  return typeof payload === "string"
    && payload.length > 0
    && payload.length <= MAX_PAYLOAD_LENGTH
    && !CONTROL_CHARACTERS.test(payload);
}

function normalizeConfidence(confidence) {
  if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) {
    return confidence;
  }
  return null;
}

function collectLinks(candidates) {
  const links = [];
  const seenLinks = new Set();
  for (const candidate of candidates) {
    const payload = extractPayload(candidate);
    if (isHttpUrl(payload) && !seenLinks.has(payload)) {
      links.push(payload);
      seenLinks.add(payload);
    }
  }
  return links;
}

function isHttpUrl(payload) {
  if (!isSafePayload(payload)) {
    return false;
  }

  try {
    const parsedUrl = new URL(payload);
    return parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

module.exports = { detectCodes };
