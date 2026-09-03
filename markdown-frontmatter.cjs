const { assertSafeIdentifier, assertSafeTitle } = require("./src/shared/validation.cjs");

const FRONTMATTER_FORMAT = "clipboard-shelf";
const FRONTMATTER_VERSION = 1;
const FRONTMATTER_KEYS = Object.freeze([
  "format",
  "version",
  "kind",
  "id",
  "title",
  "collectionId",
  "collectionTitle",
  "portable"
]);
const FRONTMATTER_KINDS = new Set(["library", "group", "collection"]);

function assertFrontmatterValue(key, value) {
  if (key === "format" && value !== FRONTMATTER_FORMAT) {
    throw new TypeError("Frontmatter format is invalid");
  }
  if (key === "version" && (!Number.isSafeInteger(value) || value !== FRONTMATTER_VERSION)) {
    throw new TypeError("Frontmatter version is invalid");
  }
  if (key === "kind" && !FRONTMATTER_KINDS.has(value)) {
    throw new TypeError("Frontmatter kind is invalid");
  }
  if (["id", "collectionId"].includes(key)) {
    assertSafeIdentifier(value, `frontmatter ${key}`);
  }
  if (["title", "collectionTitle"].includes(key)) {
    assertSafeTitle(value, `frontmatter ${key}`);
  }
  if (key === "portable" && typeof value !== "boolean") {
    throw new TypeError("Frontmatter portable flag is invalid");
  }
}

function parseFrontmatterValue(key, rawValue) {
  const value = rawValue.startsWith('"') ? JSON.parse(rawValue) : parseScalar(rawValue);
  if (["format", "kind", "id", "title", "collectionId", "collectionTitle"].includes(key)
    && typeof value !== "string") {
    throw new TypeError(`Frontmatter ${key} must be a string`);
  }
  assertFrontmatterValue(key, value);
  return value;
}

function parseScalar(rawValue) {
  if (rawValue === "true") {
    return true;
  }
  if (rawValue === "false") {
    return false;
  }
  if (/^-?\d+$/.test(rawValue)) {
    return Number(rawValue);
  }
  return rawValue;
}

function formatFrontmatterValue(value) {
  return typeof value === "string" && /^[A-Za-z0-9._/-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

function normalizedFrontmatter(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new TypeError("Frontmatter metadata must be an object");
  }

  const normalized = {
    format: metadata.format ?? FRONTMATTER_FORMAT,
    version: metadata.version ?? FRONTMATTER_VERSION
  };
  FRONTMATTER_KEYS.slice(2).forEach((key) => {
    if (Object.hasOwn(metadata, key) && metadata[key] !== undefined) {
      normalized[key] = metadata[key];
    }
  });
  Object.entries(normalized).forEach(([key, value]) => assertFrontmatterValue(key, value));
  return normalized;
}

function serializeFrontmatter(metadata) {
  const normalized = normalizedFrontmatter(metadata);
  return [
    "---",
    ...FRONTMATTER_KEYS.filter((key) => Object.hasOwn(normalized, key))
      .map((key) => `${key}: ${formatFrontmatterValue(normalized[key])}`),
    "---",
    ""
  ].join("\n");
}

function readFrontmatterHeader(markdown) {
  const opening = markdown.match(/^---\r?\n/);
  if (!opening) {
    return null;
  }

  const closing = /\r?\n---(?:\r?\n|$)/.exec(markdown.slice(opening[0].length));
  if (!closing) {
    throw new TypeError("Frontmatter closing delimiter is missing");
  }

  return {
    header: markdown.slice(opening[0].length, opening[0].length + closing.index),
    body: markdown.slice(opening[0].length + closing.index + closing[0].length)
  };
}

function parseFrontmatter(markdown) {
  if (typeof markdown !== "string") {
    throw new TypeError("Markdown text is required");
  }

  const header = readFrontmatterHeader(markdown);
  if (!header) {
    return { metadata: {}, body: markdown };
  }

  const metadata = {};
  header.header.split(/\r?\n/).filter((line) => line.length > 0).forEach((line) => {
    const separator = line.indexOf(":");
    if (separator <= 0) {
      throw new TypeError("Frontmatter line is malformed");
    }

    const key = line.slice(0, separator);
    const rawValue = line.slice(separator + 1).trim();
    if (!FRONTMATTER_KEYS.includes(key)) {
      return;
    }
    if (Object.hasOwn(metadata, key)) {
      throw new TypeError(`Frontmatter key ${key} is duplicated`);
    }
    metadata[key] = parseFrontmatterValue(key, rawValue);
  });

  if (metadata.format !== FRONTMATTER_FORMAT || metadata.version !== FRONTMATTER_VERSION) {
    throw new TypeError("Frontmatter format or version is missing");
  }

  return { metadata, body: header.body };
}

module.exports = {
  FRONTMATTER_FORMAT,
  FRONTMATTER_KEYS,
  FRONTMATTER_VERSION,
  parseFrontmatter,
  serializeFrontmatter
};
