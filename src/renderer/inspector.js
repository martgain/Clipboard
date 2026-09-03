export const REDACTED_VALUE = "[REDACTED]";
const SENSITIVE_KEY = /(?:password|passphrase|secret|token|authorization|cookie|credential|private[-_ ]?key|api[-_ ]?key|file[-_ ]?path|directory|pathname)/i;

function redactMetadataValue(metadataValue, propertyName, seen = new WeakMap()) {
  if (SENSITIVE_KEY.test(propertyName || "")) {
    return REDACTED_VALUE;
  }
  if (typeof metadataValue === "string") {
    return /^(?:bearer|basic)\s|^[A-Za-z]:[\\/]|^(?:\\\\|\/)/i.test(metadataValue)
      ? REDACTED_VALUE
      : metadataValue;
  }
  if (metadataValue === null || typeof metadataValue !== "object") {
    return metadataValue;
  }
  if (seen.has(metadataValue)) {
    return seen.get(metadataValue);
  }

  if (Array.isArray(metadataValue)) {
    const redactedArray = [];
    seen.set(metadataValue, redactedArray);
    metadataValue.forEach((arrayEntry) => redactedArray.push(redactMetadataValue(arrayEntry, "", seen)));
    return redactedArray;
  }

  const redactedObject = {};
  seen.set(metadataValue, redactedObject);
  Object.entries(metadataValue).forEach(([entryKey, entryValue]) => {
    redactedObject[entryKey] = redactMetadataValue(entryValue, entryKey, seen);
  });
  return redactedObject;
}

function freezeDeep(objectValue, seen = new WeakSet()) {
  if (!objectValue || typeof objectValue !== "object" || seen.has(objectValue)) {
    return objectValue;
  }
  seen.add(objectValue);
  Object.values(objectValue).forEach((childValue) => freezeDeep(childValue, seen));
  return Object.freeze(objectValue);
}

function entryImageDescriptor(entry) {
  const image = entry.image && typeof entry.image === "object" ? entry.image : {};
  const descriptor = {};
  addImageStringField(descriptor, "blobKey", image.blobKey ?? entry.mediaKey);
  addImageStringField(descriptor, "mediaKey", image.mediaKey);
  addImageStringField(descriptor, "mimeType", image.mimeType);
  addImageNumberField(descriptor, "size", image.size ?? entry.size);
  addImageStringField(descriptor, "hash", image.hash ?? entry.hash);
  return descriptor;
}

function addImageStringField(descriptor, fieldName, fieldValue) {
  if (typeof fieldValue === "string" && fieldValue) {
    descriptor[fieldName] = fieldValue;
  }
}

function addImageNumberField(descriptor, fieldName, fieldValue) {
  if (Number.isFinite(fieldValue)) {
    descriptor[fieldName] = fieldValue;
  }
}

function membershipsFor(entry, options) {
  if (Array.isArray(options.listMemberships)) {
    return [...options.listMemberships];
  }
  if (Array.isArray(entry.listMemberships)) {
    return [...entry.listMemberships];
  }

  const state = options.state;
  if (!state || typeof state !== "object") {
    return [];
  }

  const memberships = [];
  ["pinned", "pins", "normal"].forEach((listName) => {
    if (Array.isArray(state[listName]) && state[listName].some((candidateEntry) => candidateEntry?.id === entry.id)) {
      memberships.push(listName);
    }
  });
  return [...new Set(memberships)];
}

export function redactMetadata(metadata) {
  return redactMetadataValue(metadata, "");
}

function createBaseInspectorModel(entry, options) {
  const entryType = typeof entry.type === "string" ? entry.type : entry.image ? "image" : "text";
  const capturedAt = entry.capturedAt ?? entry.createdAt;
  const source = entry.sourceApp ?? entry.source ?? entry.metadata?.sourceApp;
  const size = entry.size ?? entry.image?.size;
  const hash = entry.hash ?? entry.image?.hash;
  const inspectorModel = {
    id: entry.id,
    type: entryType,
    capturedAt,
    source: redactMetadata(source),
    tags: Array.isArray(entry.tags) ? [...entry.tags] : [],
    listMemberships: membershipsFor(entry, options),
    metadata: redactMetadata(entry.metadata ?? {})
  };
  addOptionalMetadata(inspectorModel, size, hash);
  return inspectorModel;
}

function addOptionalMetadata(inspectorModel, size, hash) {
  if (Number.isFinite(size)) {
    inspectorModel.size = size;
  }
  if (typeof hash === "string" && hash) {
    inspectorModel.hash = hash;
  }
}

function addContentPreview(inspectorModel, entry) {
  if (inspectorModel.type === "image") {
    const image = entryImageDescriptor(entry);
    inspectorModel.image = image;
    inspectorModel.content = image;
    inspectorModel.preview = { kind: "image", ...image };
    return;
  }

  const textContent = typeof entry.text === "string"
    ? entry.text
    : typeof entry.content === "string"
      ? entry.content
      : "";
  inspectorModel.text = textContent;
  inspectorModel.content = textContent;
  inspectorModel.preview = textContent;
}

export function inspectEntry(entry, options = {}) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const inspectorModel = createBaseInspectorModel(entry, options);
  addContentPreview(inspectorModel, entry);
  return freezeDeep(inspectorModel);
}

export function buildInspectorModel(entry, options) {
  return inspectEntry(entry, options);
}

export class Inspector {
  static inspect(entry, options) {
    return inspectEntry(entry, options);
  }
}
