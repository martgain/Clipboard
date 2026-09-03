const { parseSearchQuery } = require("./search-query.cjs");
const { evaluateSearch, normalizeArabicSearch } = require("./search-index.cjs");

function normalizeSearchValue(value) {
  if (typeof value !== "string") return "";
  return normalizeArabicSearch(value.normalize("NFKC"));
}

function sourceValues(entry) {
  const source = entry?.sourceApp ?? entry?.source;
  if (typeof source === "string") {
    return [source];
  }
  if (!source || typeof source !== "object") {
    return [];
  }
  return [source.executable, source.app, source.name, source.process, source.processName]
    .filter((value) => typeof value === "string");
}

function normalizedDate(value, inclusiveEnd = false) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return null;
    return inclusiveEnd && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
      ? parsed + 86_400_000 - 1
      : parsed;
  }
  return null;
}

function matchesSource(entry, requestedSource) {
  if (typeof requestedSource !== "string" || requestedSource.trim().length === 0) {
    return true;
  }
  const normalizedSource = normalizeSearchValue(requestedSource).trim();
  return sourceValues(entry).some((value) => normalizeSearchValue(value).trim() === normalizedSource);
}

function matchesDateRange(entry, options) {
  const from = normalizedDate(options.dateFrom);
  const to = normalizedDate(options.dateTo, true);
  if (from === null && to === null) {
    return true;
  }
  const capturedAt = normalizedDate(entry?.capturedAt ?? entry?.createdAt ?? entry?.updatedAt);
  return capturedAt !== null && (from === null || capturedAt >= from) && (to === null || capturedAt <= to);
}

function filterLibraryEntries(entries, options = {}) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const parsedQuery = options.query ? parseSearchQuery(options.query) : { ast: null, error: null };
  if (parsedQuery.error) {
    return [];
  }
  const { ast } = parsedQuery;
  const type = options.type === "text" || options.type === "image" ? options.type : "all";
  const tag = normalizeSearchValue(options.tag).trim();

  let results = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || (type !== "all" && entry.type !== type)) {
      continue;
    }

    const entryTags = Array.isArray(entry.tags) ? entry.tags : [];
    if (tag && !entryTags.some((candidate) => normalizeSearchValue(candidate) === tag)) {
      continue;
    }
    if (!matchesSource(entry, options.source ?? options.sourceApp) || !matchesDateRange(entry, options)) {
      continue;
    }

    const searchResult = evaluateSearch(entry, ast);
    if (!searchResult.matched) {
      continue;
    }

    results.push({
      entry,
      score: searchResult.score,
      ranges: searchResult.ranges,
      originalIndex: i
    });
  }

  // Deterministic sort: score descending, then original order ascending
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIndex - b.originalIndex;
  });

  if (options.includeMetadata !== true) {
    return results.map(({ entry }) => entry);
  }

  return results.map(({ entry, ranges, score }) => ({
    ...entry,
    searchRanges: ranges,
    searchScore: score
  }));
}

module.exports = {
  filterLibraryEntries,
  normalizeSearchValue
};
