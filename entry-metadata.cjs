const {
  assertEntryDomain,
  assertEntryNote,
  assertEntryTitle,
  assertEntryTags,
  MAX_ENTRY_DOMAIN_LENGTH,
  MAX_ENTRY_NOTE_LENGTH,
  MAX_ENTRY_TITLE_LENGTH
} = require("./src/shared/validation.cjs");

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const EMPTY_LINK_METADATA = Object.freeze({ title: null, domain: null, url: null });

function normalizeEntryMetadata(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new TypeError("Entry metadata requires an entry object");
  }

  const normalizedEntry = { ...entry };
  if (Object.hasOwn(entry, "tags")) {
    assertEntryTags(entry);
  }
  if (Object.hasOwn(entry, "note")) {
    assertEntryNote(entry.note);
  }
  if (Object.hasOwn(entry, "title")) {
    assertEntryTitle(entry.title);
  }
  if (Object.hasOwn(entry, "domain")) {
    assertEntryDomain(entry.domain);
  }
  return normalizedEntry;
}

function trimUrlPunctuation(candidate) {
  return candidate.replace(/[.,!?;:]+$/g, "").replace(/[\])}]+$/g, "");
}

function extractLinkMetadata(text) {
  if (typeof text !== "string") {
    return { ...EMPTY_LINK_METADATA };
  }

  const match = [...text.matchAll(URL_PATTERN)].map(([url]) => trimUrlPunctuation(url))
    .find((url) => isHttpUrl(url));
  if (!match) {
    return { ...EMPTY_LINK_METADATA };
  }

  const parsedUrl = new URL(match);
  return { title: null, domain: parsedUrl.hostname.toLowerCase(), url: match };
}

function isHttpUrl(value) {
  try {
    const parsedUrl = new URL(value);
    return (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") && parsedUrl.hostname.length > 0;
  } catch (error) {
    return false;
  }
}

module.exports = {
  EMPTY_LINK_METADATA,
  MAX_ENTRY_DOMAIN_LENGTH,
  MAX_ENTRY_NOTE_LENGTH,
  MAX_ENTRY_TITLE_LENGTH,
  extractLinkMetadata,
  normalizeEntryMetadata
};
