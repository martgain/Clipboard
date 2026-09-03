const crypto = require("node:crypto");

function toBuffer(value) {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(value));
  }
  throw new TypeError("Clipboard image bytes are required");
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function parseImageDataUrl(dataUrl) {
  const match = typeof dataUrl === "string"
    ? /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
    : null;

  if (!match) {
    throw new TypeError("Clipboard image must be a base64 image data URL");
  }

  return { mimeType: match[1].toLowerCase(), bytes: Buffer.from(match[2].replace(/\s/g, ""), "base64") };
}

function normalizeEvent(event) {
  return event && typeof event === "object" && !Array.isArray(event) ? event : {};
}

function optionalField(source, name, fallback) {
  return source[name] !== undefined ? source[name] : fallback;
}

function normalizeFormats(formats) {
  return Array.isArray(formats)
    ? [...new Set(formats.filter((format) => typeof format === "string" && format.trim().length > 0))]
    : [];
}

function normalizeRichFormats(richFormats) {
  return Array.isArray(richFormats)
    ? richFormats.filter((format) => format && typeof format === "object" && !Array.isArray(format)).map((format) => ({ ...format }))
    : [];
}

function normalizeSourceApp(sourceApp) {
  if (!sourceApp || typeof sourceApp !== "object" || Array.isArray(sourceApp)) {
    return undefined;
  }

  const normalized = {};
  if (typeof sourceApp.executable === "string" && sourceApp.executable.trim().length > 0) {
    normalized.executable = sourceApp.executable.trim().slice(0, 260);
  }
  if (Number.isSafeInteger(sourceApp.pid) && sourceApp.pid > 0) {
    normalized.pid = sourceApp.pid;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeImagePayload(rawPayload) {
  const raw = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  let mimeType = typeof raw.mimeType === "string" ? raw.mimeType.toLowerCase() : null;
  let bytes;

  if (raw.bytes !== undefined) {
    bytes = toBuffer(raw.bytes);
  } else if (raw.dataUrl !== undefined) {
    const parsed = parseImageDataUrl(raw.dataUrl);
    mimeType ||= parsed.mimeType;
    bytes = parsed.bytes;
  } else {
    throw new TypeError("Clipboard image bytes are unavailable");
  }

  if (!mimeType || !/^image\/[a-z0-9.+-]+$/i.test(mimeType)) {
    throw new TypeError("Clipboard image MIME type is invalid");
  }

  const actualHash = sha256Hex(bytes);
  if (raw.sha256 !== undefined && (typeof raw.sha256 !== "string" || raw.sha256.toLowerCase() !== actualHash)) {
    throw new TypeError("Clipboard image SHA-256 does not match its bytes");
  }
  if (raw.size !== undefined && raw.size !== bytes.length) {
    throw new RangeError("Clipboard image size does not match its bytes");
  }

  return {
    kind: "image",
    mimeType,
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    sha256: actualHash,
    size: bytes.length
  };
}

function normalizeSnapshot(rawSnapshot, event = {}) {
  if (!rawSnapshot || typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot)) {
    throw new TypeError("Clipboard snapshot must be an object");
  }

  const source = normalizeEvent(event);
  const rawPayload = rawSnapshot.payload;
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    throw new TypeError("Clipboard snapshot payload must be an object");
  }

  const kind = rawPayload.kind || rawPayload.type;
  const payload = kind === "image"
    ? normalizeImagePayload(rawPayload)
    : kind === "text" && typeof rawPayload.text === "string"
      ? { kind: "text", text: rawPayload.text }
      : null;

  if (!payload) {
    throw new TypeError("Unsupported clipboard snapshot payload");
  }

  const sequence = optionalField(rawSnapshot, "sequence", source.sequence);
  const capturedAt = optionalField(rawSnapshot, "capturedAt", source.capturedAt);
  const sourceApp = normalizeSourceApp(optionalField(rawSnapshot, "sourceApp", source.sourceApp));
  const formats = normalizeFormats(optionalField(rawSnapshot, "formats", source.formats));
  const richFormats = normalizeRichFormats(optionalField(rawSnapshot, "richFormats", source.richFormats));
  const normalized = {
    signature: payload.kind === "text" ? `text:${payload.text}` : `image:${payload.sha256}`,
    payload,
    formats,
    richFormats
  };

  if (sequence !== undefined) normalized.sequence = sequence;
  if (capturedAt !== undefined) normalized.capturedAt = capturedAt;
  if (sourceApp !== undefined) normalized.sourceApp = sourceApp;
  return normalized;
}

async function readFallbackSnapshot(adapter, event) {
  if (!adapter || typeof adapter.readImage !== "function" || typeof adapter.readText !== "function") {
    throw new TypeError("A clipboard adapter is required");
  }

  let image = null;
  let imageReadError = null;
  try {
    image = await adapter.readImage();
  } catch (error) {
    imageReadError = error;
  }
  if (image) {
    return normalizeSnapshot({
      ...event,
      formats: [...(Array.isArray(event.formats) ? event.formats : []), "image"],
      payload: { kind: "image", ...image }
    }, event);
  }

  try {
    return normalizeSnapshot({
      ...event,
      formats: [...(Array.isArray(event.formats) ? event.formats : []), "text"],
      payload: { kind: "text", text: await adapter.readText() }
    }, event);
  } catch (textReadError) {
    if (imageReadError) {
      textReadError.cause = imageReadError;
    }
    throw textReadError;
  }
}

async function readClipboardSnapshot({ richAdapter = null, fallbackAdapter = null, event = null } = {}) {
  const normalizedEvent = normalizeEvent(event);
  let richError = null;

  if (richAdapter && typeof richAdapter.readSnapshot === "function") {
    try {
      return normalizeSnapshot(await richAdapter.readSnapshot({
        formats: normalizedEvent.formats,
        sequence: normalizedEvent.sequence,
        capturedAt: normalizedEvent.capturedAt,
        sourceApp: normalizedEvent.sourceApp
      }), normalizedEvent);
    } catch (error) {
      richError = error;
    }
  }

  if (fallbackAdapter) {
    return readFallbackSnapshot(fallbackAdapter, normalizedEvent);
  }

  throw richError || new TypeError("Clipboard adapter is unavailable");
}

function snapshotToPayload(snapshot) {
  const normalized = normalizeSnapshot(snapshot);
  const payload = { ...normalized.payload };

  if (normalized.sequence !== undefined) payload.sequence = normalized.sequence;
  if (normalized.capturedAt !== undefined) payload.capturedAt = normalized.capturedAt;
  if (normalized.sourceApp !== undefined) payload.sourceApp = normalized.sourceApp;
  if (normalized.formats.length > 0) payload.formats = normalized.formats.slice();
  if (normalized.richFormats.length > 0) payload.richFormats = normalized.richFormats.map((format) => ({ ...format }));
  return payload;
}

module.exports = Object.freeze({
  normalizeSnapshot,
  readClipboardSnapshot,
  snapshotToPayload
});
