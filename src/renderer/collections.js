const SUPPORTED_TYPES = new Set(["text", "image", "file", "bookmark"]);

function normalizeText(searchText) {
  return typeof searchText === "string" ? searchText.normalize("NFKC").toLocaleLowerCase() : "";
}

function asList(listValue) {
  if (Array.isArray(listValue)) {
    return listValue;
  }
  return listValue === undefined || listValue === null ? [] : [listValue];
}

function normalizeList(listValues) {
  return asList(listValues)
    .filter((listValue) => typeof listValue === "string")
    .map((listValue) => normalizeText(listValue).trim())
    .filter(Boolean);
}

function entrySourceValues(entry) {
  const source = entry.source;
  const sourceObject = source && typeof source === "object" ? source : {};
  return [
    entry.sourceApp,
    entry.sourceProcess,
    entry.processName,
    source,
    sourceObject.app,
    sourceObject.name,
    sourceObject.process,
    sourceObject.processName,
    entry.metadata?.sourceApp
  ].filter((sourceValue) => typeof sourceValue === "string");
}

function entryDateValue(entry) {
  const dateValue = entry.capturedAt ?? entry.createdAt ?? entry.updatedAt;
  if (typeof dateValue === "number" && Number.isFinite(dateValue)) {
    return dateValue;
  }

  if (typeof dateValue === "string") {
    const parsed = Date.parse(dateValue);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function queryDateValue(dateValue) {
  if (typeof dateValue === "number" && Number.isFinite(dateValue)) {
    return dateValue;
  }
  if (typeof dateValue === "string" && dateValue.trim()) {
    const parsed = Date.parse(dateValue);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function entrySearchText(entry) {
  return normalizeText([
    entry.text,
    entry.content,
    ...(Array.isArray(entry.tags) ? entry.tags : []),
    ...entrySourceValues(entry)
  ].filter((searchPart) => typeof searchPart === "string").join(" "));
}

function matchesType(entry, type) {
  if (!type) {
    return true;
  }
  return Array.isArray(type) ? type.includes(entry.type) : entry.type === type;
}

function matchesTags(entry, requestedTags, mode) {
  if (requestedTags.length === 0) {
    return true;
  }

  const tags = new Set(normalizeList(entry.tags));
  return mode === "any"
    ? requestedTags.some((tag) => tags.has(tag))
    : requestedTags.every((tag) => tags.has(tag));
}

function matchesSources(entry, requestedSources) {
  if (requestedSources.length === 0) {
    return true;
  }

  const sources = new Set(entrySourceValues(entry).map((sourceValue) => normalizeText(sourceValue).trim()));
  return requestedSources.some((source) => sources.has(source));
}

function matchesDateRange(entry, query) {
  const from = queryDateValue(query.dateFrom);
  const to = queryDateValue(query.dateTo);
  if (from === null && to === null) {
    return true;
  }

  const timestamp = entryDateValue(entry);
  if (timestamp === null) {
    return false;
  }

  return (from === null || timestamp >= from) && (to === null || timestamp <= to);
}

function collectEntries(state) {
  const lists = [state?.pinned, state?.pins, state?.normal];
  const entries = [];
  const seenIds = new Set();
  const seenLists = new Set();

  lists.forEach((list) => {
    if (!Array.isArray(list) || seenLists.has(list)) {
      return;
    }
    seenLists.add(list);
    appendUniqueEntries(entries, list, seenIds);
  });

  return entries;
}

function appendUniqueEntries(targetEntries, sourceEntries, seenIds) {
  sourceEntries.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }
    if (typeof entry.id === "string" && seenIds.has(entry.id)) {
      return;
    }
    if (typeof entry.id === "string") {
      seenIds.add(entry.id);
    }
    targetEntries.push(entry);
  });
}

function normalizeTypeFilter(candidateType) {
  if (typeof candidateType === "string" && SUPPORTED_TYPES.has(candidateType)) {
    return candidateType;
  }
  if (Array.isArray(candidateType)) {
    const supportedTypes = candidateType.filter((type) => SUPPORTED_TYPES.has(type));
    return supportedTypes.length > 0 ? [...supportedTypes] : undefined;
  }
  return undefined;
}

function addDateFilter(normalizedQuery, query, fieldName) {
  if (queryDateValue(query[fieldName]) !== null) {
    normalizedQuery[fieldName] = query[fieldName];
  }
}

function addTextFilter(normalizedQuery, query) {
  const text = query.text ?? query.search;
  if (typeof text === "string" && text.trim()) {
    normalizedQuery.text = text.trim();
  }
}

function addTypeFilter(normalizedQuery, query) {
  const typeFilter = normalizeTypeFilter(query.type);
  if (typeFilter) {
    normalizedQuery.type = typeFilter;
  }
}

function addListFilter(normalizedQuery, query, fieldName, aliasName) {
  const normalizedValues = normalizeList(query[fieldName] ?? query[aliasName]);
  if (normalizedValues.length > 0) {
    normalizedQuery[fieldName] = [...new Set(normalizedValues)];
  }
}

export function normalizeCollectionQuery(query = {}) {
  if (!query || typeof query !== "object" || Array.isArray(query)) {
    return {};
  }

  const normalized = {};
  addTextFilter(normalized, query);
  addTypeFilter(normalized, query);
  addListFilter(normalized, query, "tags", "tag");
  addListFilter(normalized, query, "sourceApps", "sourceApp");

  if (query.tagMode === "any") {
    normalized.tagMode = "any";
  }

  addDateFilter(normalized, query, "dateFrom");
  addDateFilter(normalized, query, "dateTo");

  return normalized;
}

export function matchesCollectionQuery(entry, query = {}) {
  if (!entry || typeof entry !== "object") {
    return false;
  }

  return matchesNormalizedCollectionQuery(entry, normalizeCollectionQuery(query));
}

function matchesNormalizedCollectionQuery(entry, normalizedQuery) {
  const search = normalizeText(normalizedQuery.text).trim();
  return matchesType(entry, normalizedQuery.type)
    && (!search || entrySearchText(entry).includes(search))
    && matchesTags(entry, normalizedQuery.tags || [], normalizedQuery.tagMode)
    && matchesSources(entry, normalizedQuery.sourceApps || [])
    && matchesDateRange(entry, normalizedQuery);
}

export function evaluateCollection(state, query = {}) {
  const normalizedQuery = normalizeCollectionQuery(query);
  return collectEntries(state).filter((entry) => matchesNormalizedCollectionQuery(entry, normalizedQuery));
}

export class CollectionQuery {
  static evaluate(state, query = {}) {
    return evaluateCollection(state, query);
  }
}

export function createSmartCollection({ id, title, name, query = {} } = {}) {
  const collectionId = typeof id === "string" && id.trim() ? id.trim() : null;
  const collectionTitle = typeof title === "string" && title.trim()
    ? title.trim()
    : typeof name === "string" && name.trim()
      ? name.trim()
      : null;

  if (!collectionId || !collectionTitle) {
    throw new TypeError("Smart collections require an id and title");
  }

  const storedQuery = normalizeCollectionQuery(query);
  return Object.freeze({
    id: collectionId,
    title: collectionTitle,
    kind: "smart",
    query: freezeCollectionQuery(storedQuery)
  });
}

function freezeCollectionQuery(collectionQuery) {
  const frozenQuery = { ...collectionQuery };
  if (collectionQuery.tags) {
    frozenQuery.tags = Object.freeze([...collectionQuery.tags]);
  }
  if (collectionQuery.sourceApps) {
    frozenQuery.sourceApps = Object.freeze([...collectionQuery.sourceApps]);
  }
  return Object.freeze(frozenQuery);
}

export function resolveCollection(state, collection) {
  return collection?.kind === "smart"
    ? evaluateCollection(state, collection.query)
    : [];
}
