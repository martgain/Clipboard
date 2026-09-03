const path = require("node:path");
const { normalizeGroupIcon } = require("./link-group-icons.js");
const { normalizeEntryMetadata } = require("./entry-metadata.cjs");
const { parseFrontmatter, serializeFrontmatter } = require("./markdown-frontmatter.cjs");
const { buildRelativeAttachmentPath, parseAttachmentReference } = require("./attachment-paths.cjs");

const MARKDOWN_SCHEMA_VERSION = 1;
const FORMAT_MARKER = "clipboard-shelf:format";
const GROUPS_MARKER = "clipboard-shelf:groups";
const END_GROUPS_MARKER = "clipboard-shelf:end-groups";
const END_ENTRY_MARKER = "clipboard-shelf:end-entry";
const SMART_COLLECTIONS_MARKER = "clipboard-shelf:smart-collections";
const TRASH_MARKER = "clipboard-shelf:trash";
const SAFE_FORMAT_PATTERN = /^[a-z][a-z0-9/+._-]{0,63}$/i;
const SAFE_HASH_PATTERN = /^[a-f0-9]{64}$/i;

function normalizeClipboardMetadata(entry) {
  const metadata = {};
  const sourceApp = entry?.sourceApp;

  if (sourceApp && typeof sourceApp === "object" && !Array.isArray(sourceApp)) {
    const normalizedSource = {};
    if (typeof sourceApp.executable === "string" && sourceApp.executable.trim().length > 0) {
      normalizedSource.executable = sourceApp.executable.trim().slice(0, 260);
    }
    if (Number.isSafeInteger(sourceApp.pid) && sourceApp.pid > 0) {
      normalizedSource.pid = sourceApp.pid;
    }
    if (Object.keys(normalizedSource).length > 0) {
      metadata.sourceApp = normalizedSource;
    }
  }

  if (Array.isArray(entry?.formats)) {
    const formats = [...new Set(entry.formats
      .filter((format) => typeof format === "string" && SAFE_FORMAT_PATTERN.test(format.trim()))
      .map((format) => format.trim()))];
    if (formats.length > 0) {
      metadata.formats = formats.slice(0, 20);
    }
  }

  if (Array.isArray(entry?.richFormats)) {
    const richFormats = entry.richFormats.map((richFormat) => {
      if (!richFormat || typeof richFormat !== "object" || Array.isArray(richFormat)) {
        return null;
      }

      const normalized = {};
      if (typeof richFormat.format === "string" && SAFE_FORMAT_PATTERN.test(richFormat.format.trim())) {
        normalized.format = richFormat.format.trim();
      } else {
        return null;
      }
      for (const property of ["mimeType", "name", "title", "url"]) {
        if (typeof richFormat[property] === "string" && richFormat[property].length <= 2048) {
          normalized[property] = richFormat[property];
        }
      }
      if (Number.isSafeInteger(richFormat.size) && richFormat.size >= 0) {
        normalized.size = richFormat.size;
      }
      if (typeof richFormat.sha256 === "string" && SAFE_HASH_PATTERN.test(richFormat.sha256)) {
        normalized.sha256 = richFormat.sha256.toLowerCase();
      }
      if (richFormat.available === true) {
        normalized.available = true;
      }
      return normalized;
    }).filter(Boolean).slice(0, 20);
    if (richFormats.length > 0) {
      metadata.richFormats = richFormats;
    }
  }

  return metadata;
}

function parsedClipboardMetadata(metadata) {
  return normalizeClipboardMetadata(metadata || {});
}

function normalizedEntryFields(entry) {
  const normalized = normalizeEntryMetadata(entry);
  return ["note", "title", "domain"].reduce((fields, key) => {
    if (Object.hasOwn(normalized, key)) {
      fields[key] = normalized[key];
    }
    return fields;
  }, {});
}

function portableImageMetadata(image, portable, attachmentDirectory = "media") {
  if (!portable || !image || !/^[a-f0-9]{64}$/i.test(image.blobKey)) {
    return image;
  }

  const { blobKey, ...metadata } = image;
  return { ...metadata, path: buildRelativeAttachmentPath(blobKey, attachmentDirectory) };
}

function parsedImageMetadata(image) {
  if (!image || typeof image !== "object") {
    return image;
  }

  const referencePath = image.path || image.attachment || image.attachmentPath;
  if (referencePath === undefined) {
    return image;
  }

  const reference = parseAttachmentReference(referencePath);
  if (image.blobKey !== undefined && image.blobKey.toLowerCase() !== reference.mediaKey) {
    throw new TypeError("Attachment path does not match media key");
  }
  if (image.hash !== undefined && image.hash.toLowerCase() !== reference.mediaKey) {
    throw new TypeError("Attachment path does not match image hash");
  }

  const metadata = { ...image };
  delete metadata.path;
  delete metadata.attachment;
  delete metadata.attachmentPath;
  return { ...metadata, blobKey: reference.mediaKey };
}

function jsonComment(marker, value) {
  const serializedValue = JSON.stringify(value).replace(/-->/g, "--\\u003e");
  return `<!-- ${marker} ${serializedValue} -->`;
}

function formatMarker() {
  return jsonComment(FORMAT_MARKER, { version: MARKDOWN_SCHEMA_VERSION });
}

function chooseFence(text) {
  const backtickRun = longestRun(text, "`");
  const tildeRun = longestRun(text, "~");
  const character = backtickRun <= tildeRun ? "`" : "~";
  const length = Math.max(3, (character === "`" ? backtickRun : tildeRun) + 1);
  return character.repeat(length);
}

function longestRun(text, character) {
  const runs = String(text).match(new RegExp(`${character === "`" ? "\\`" : "~"}+`, "g")) || [];
  return runs.reduce((longest, run) => Math.max(longest, run.length), 0);
}

function serializeTextEntry(entry, { portable = true } = {}) {
  const text = typeof entry.text === "string" ? entry.text : "";
  const entryFields = normalizedEntryFields(entry);
  const metadata = {
    id: entry.id,
    type: "text",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    endsWithNewline: text.endsWith("\n"),
    ...entryFields,
    ...normalizeClipboardMetadata(entry)
  };
  const fence = chooseFence(text);
  const content = text.endsWith("\n") ? text : `${text}\n`;

  return `${jsonComment("clipboard-shelf:entry", metadata)}\n${fence}text\n${content}${fence}\n${jsonComment(END_ENTRY_MARKER, true)}`;
}

function serializeImageEntry(entry, { portable = true, attachmentDirectory = "media" } = {}) {
  return jsonComment("clipboard-shelf:entry", {
    id: entry.id,
    type: "image",
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    image: portableImageMetadata(entry.image, portable, attachmentDirectory),
    ...normalizedEntryFields(entry),
    ...normalizeClipboardMetadata(entry)
  }) + `\n${jsonComment(END_ENTRY_MARKER, true)}`;
}

function serializeEntry(entry, options) {
  return entry.type === "image" ? serializeImageEntry(entry, options) : serializeTextEntry(entry, options);
}

function portableTrashRecords(trash, options = {}) {
  const records = Array.isArray(trash) ? trash : [];
  return records.map((record) => {
    if (record?.entry?.type !== "image") {
      return record;
    }

    return {
      ...record,
      entry: {
        ...record.entry,
        image: portableImageMetadata(
          record.entry.image,
          options.portable !== false,
          options.attachmentDirectory || "media"
        )
      }
    };
  });
}

function serializeEntryList(listName, entries, options) {
  const lines = [jsonComment(`clipboard-shelf:list ${listName}`, true)];
  entries.forEach((entry) => lines.push(serializeEntry(entry, options)));
  lines.push(jsonComment(`clipboard-shelf:end-list ${listName}`, true));
  return lines.join("\n");
}

function serializeGroupBlock(group) {
  const metadata = {
    id: group.id,
    name: group.name,
    icon: normalizeGroupIcon(group.icon),
    createdAt: group.createdAt,
    updatedAt: group.updatedAt
  };

  if (Array.isArray(group.items)) {
    metadata.items = group.items;
    return `${jsonComment("clipboard-shelf:group", metadata)}\n${jsonComment("clipboard-shelf:end-group", true)}`;
  }

  const links = group.links.map((link) => `- ${link}`);
  return `${jsonComment("clipboard-shelf:group", metadata)}\n${links.join("\n")}\n${jsonComment("clipboard-shelf:end-group", true)}`;
}

function serializeLinkGroupMarkdown(group) {
  return [
    serializeFrontmatter({ kind: "group", id: group.id, title: group.name }).trimEnd(),
    `# ${group.name}`,
    formatMarker(),
    serializeGroupBlock(group),
    ""
  ].join("\n");
}

function serializeLibraryLines(library, options) {
  const lines = ["# رف الحافظة", formatMarker(), jsonComment("clipboard-shelf:settings", library.settings)];
  lines.push(serializeEntryList("pinned", library.pinned, options));
  lines.push(serializeEntryList("normal", library.normal, options));
  lines.push(jsonComment(SMART_COLLECTIONS_MARKER, Array.isArray(library.smartCollections) ? library.smartCollections : []));
  lines.push(jsonComment(TRASH_MARKER, portableTrashRecords(library.trash, options)));

  return lines;
}

function serializeLibraryMarkdown(library, options = {}) {
  return `${serializeFrontmatter({ kind: "library" })}${serializeLibraryLines(library, options).join("\n\n")}\n`;
}

function serializeLibrarySnapshotMarkdown(library, options = {}) {
  const lines = serializeLibraryLines(library, options);
  lines.push(jsonComment(GROUPS_MARKER, true));
  library.linkGroups.forEach((group) => lines.push(serializeGroupBlock(group)));
  lines.push(jsonComment(END_GROUPS_MARKER, true));

  return `${serializeFrontmatter({ kind: "library" })}${lines.join("\n\n")}\n`;
}

function readJsonComment(markdown, marker) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<!-- ${escapedMarker} ([\\s\\S]*?) -->`).exec(markdown);

  if (!match) {
    throw new TypeError(`Missing Markdown marker: ${marker}`);
  }

  return JSON.parse(match[1]);
}

function readOptionalJsonComment(markdown, marker, fallbackValue) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<!-- ${escapedMarker} ([\\s\\S]*?) -->`).exec(markdown);
  return match ? JSON.parse(match[1]) : fallbackValue;
}

function parsedTrashRecords(trash) {
  if (!Array.isArray(trash)) {
    return trash;
  }

  return trash.map((record) => record?.entry?.type === "image"
    ? { ...record, entry: { ...record.entry, image: parsedImageMetadata(record.entry.image) } }
    : record);
}

function readSection(markdown, marker, endMarker) {
  const start = markdown.indexOf(`<!-- ${marker} `);
  const end = markdown.indexOf(`<!-- ${endMarker} `, start);

  if (start < 0 || end < 0 || end <= start) {
    throw new TypeError(`Missing Markdown section: ${marker}`);
  }

  return markdown.slice(start, end);
}

function parseEntryList(markdown, listName) {
  const section = readSection(markdown, `clipboard-shelf:list ${listName}`, `clipboard-shelf:end-list ${listName}`);
  const entries = [];
  const markerPattern = /<!-- clipboard-shelf:entry ([\s\S]*?) -->/g;
  let markerMatch = markerPattern.exec(section);

  while (markerMatch) {
    const metadata = JSON.parse(markerMatch[1]);
    const endMarker = `<!-- ${END_ENTRY_MARKER} `;
    const endIndex = section.indexOf(endMarker, markerPattern.lastIndex);

    if (endIndex < 0) {
      throw new TypeError("Malformed Markdown entry");
    }

    const body = section.slice(markerPattern.lastIndex, endIndex);
    entries.push(parseEntry(metadata, body));
    markerPattern.lastIndex = endIndex + endMarker.length;
    markerMatch = markerPattern.exec(section);
  }

  return entries;
}

function parseEntry(metadata, body) {
  if (metadata.type === "image") {
    return {
      id: metadata.id,
      type: "image",
      image: parsedImageMetadata(metadata.image),
      tags: metadata.tags,
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
      ...normalizedEntryFields(metadata),
      ...parsedClipboardMetadata(metadata)
    };
  }

  const fenceMatch = /\n(`{3,}|~{3,})text\n/.exec(body);

  if (!fenceMatch) {
    throw new TypeError("Malformed Markdown text entry");
  }

  const contentStart = fenceMatch.index + fenceMatch[0].length;
  const closingFence = `\n${fenceMatch[1]}`;
  const contentEnd = body.lastIndexOf(closingFence);

  if (contentEnd < contentStart) {
    throw new TypeError("Malformed Markdown text fence");
  }

  let text = body.slice(contentStart, contentEnd);

  if (metadata.endsWithNewline !== true && text.endsWith("\n")) {
    text = text.slice(0, -1);
  }

  return {
    id: metadata.id,
    type: "text",
    text,
    tags: metadata.tags,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    ...normalizedEntryFields(metadata),
    ...parsedClipboardMetadata(metadata)
  };
}

function parseGroupBlocks(markdown) {
  const groups = [];
  const markerPattern = /<!-- clipboard-shelf:group ([\s\S]*?) -->/g;
  let markerMatch = markerPattern.exec(markdown);

  while (markerMatch) {
    const endMarker = "<!-- clipboard-shelf:end-group ";
    const endIndex = markdown.indexOf(endMarker, markerPattern.lastIndex);

    if (endIndex < 0) {
      throw new TypeError("Malformed Markdown group");
    }

    const metadata = JSON.parse(markerMatch[1]);
    const body = markdown.slice(markerPattern.lastIndex, endIndex);
    if (Array.isArray(metadata.items)) {
      groups.push({ ...metadata, icon: normalizeGroupIcon(metadata.icon), items: metadata.items });
    } else {
      const links = body
        .split(/\r?\n/)
        .map((line) => line.match(/^- (https?:\/\/\S+)$/)?.[1] || "")
        .filter(Boolean);
      groups.push({ ...metadata, icon: normalizeGroupIcon(metadata.icon), links });
    }
    markerPattern.lastIndex = endIndex + endMarker.length;
    markerMatch = markerPattern.exec(markdown);
  }

  return groups;
}

function parseLinkGroupMarkdown(markdown) {
  const { metadata, body } = parseFrontmatter(markdown);
  if (metadata.kind && metadata.kind !== "group") {
    throw new TypeError("Markdown document kind is not a group");
  }
  readJsonComment(body, FORMAT_MARKER);
  const group = parseGroupBlocks(body)[0];

  if (!group || typeof group.name !== "string") {
    throw new TypeError("Malformed Markdown saved group");
  }

  const hasItems = Array.isArray(group.items) && group.items.length > 0 && group.items.every((item) => typeof item === "string");
  const hasLinks = Array.isArray(group.links) && group.links.length > 0;

  if (!hasItems && !hasLinks) {
    throw new TypeError("Malformed Markdown saved group");
  }

  return group;
}

function parseLibraryMarkdown(markdown) {
  const parsedDocument = parseFrontmatter(markdown);
  if (parsedDocument.metadata.kind && parsedDocument.metadata.kind !== "library") {
    throw new TypeError("Markdown document kind is not a library");
  }
  const body = parsedDocument.body;
  if (!body.startsWith("# ")) {
    throw new TypeError("Malformed Markdown library");
  }

  readJsonComment(body, FORMAT_MARKER);
  const settings = readJsonComment(body, "clipboard-shelf:settings");
  const groups = body.includes(`<!-- ${GROUPS_MARKER} `) ? parseGroupBlocks(body) : [];

  return {
    schemaVersion: 2,
    settings,
    pinned: parseEntryList(body, "pinned"),
    normal: parseEntryList(body, "normal"),
    smartCollections: readOptionalJsonComment(body, SMART_COLLECTIONS_MARKER, []),
    trash: parsedTrashRecords(readOptionalJsonComment(body, TRASH_MARKER, [])),
    linkGroups: groups
  };
}

function serializeCollectionMarkdown(collection) {
  return `${serializeFrontmatter({ kind: "collection", id: collection.id, title: collection.title })}# ${collection.title}\n\n${jsonComment("clipboard-shelf:collection", collection)}\n`;
}

function parseCollectionMarkdown(markdown) {
  const { metadata, body } = parseFrontmatter(markdown);
  if (metadata.kind && metadata.kind !== "collection") {
    throw new TypeError("Markdown document kind is not a collection");
  }
  if (!body.startsWith("# ")) {
    throw new TypeError("Malformed Markdown collection");
  }

  const collection = readJsonComment(body, "clipboard-shelf:collection");
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new TypeError("Malformed Markdown collection metadata");
  }
  return collection;
}

function safeGroupFileName(group) {
  const nameSlug = String(group?.name || "group")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48) || "group";
  const idSlug = String(group?.id || "unknown")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "unknown";

  return `group-${nameSlug}-${idSlug}.md`;
}

function safeCollectionFileName(collection) {
  const titleSlug = String(collection?.title || "collection")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48) || "collection";
  const idSlug = String(collection?.id || "unknown")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "unknown";

  return `collection-${titleSlug}-${idSlug}.md`;
}

function safeGroupFilePath(groupsDirectory, group) {
  const root = path.resolve(groupsDirectory);
  const target = path.resolve(root, safeGroupFileName(group));
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("Group filename escapes groups directory");
  }

  return target;
}

function safeCollectionFilePath(collectionsDirectory, collection) {
  const root = path.resolve(collectionsDirectory);
  const target = path.resolve(root, safeCollectionFileName(collection));
  const relative = path.relative(root, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new TypeError("Collection filename escapes collections directory");
  }

  return target;
}

function serializeCollectionFile(collection, collectionsDirectory) {
  return {
    path: safeCollectionFilePath(collectionsDirectory, collection),
    contents: serializeCollectionMarkdown(collection)
  };
}

module.exports = {
  MARKDOWN_SCHEMA_VERSION,
  parseLibraryMarkdown,
  parseCollectionMarkdown,
  parseLinkGroupMarkdown,
  safeCollectionFileName,
  safeCollectionFilePath,
  safeGroupFileName,
  safeGroupFilePath,
  serializeLibraryMarkdown,
  serializeLibrarySnapshotMarkdown,
  serializeCollectionFile,
  serializeCollectionMarkdown,
  serializeLinkGroupMarkdown
};
