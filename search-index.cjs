const ARABIC_DIACRITICS = /[\u064B-\u065F\u0670]/g;
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;
const ARABIC_DIGITS = /[٠-٩]/g;
const PERSIAN_DIGITS = /[۰-۹]/g;
const MAX_HIGHLIGHT_RANGES = 100;

function normalizeArabicSearch(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .normalize("NFKC")
    .replace(ARABIC_DIACRITICS, "")
    .replace(BIDI_CONTROLS, "")
    .replace(/ـ/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(ARABIC_DIGITS, (digit) => String(digit.charCodeAt(0) - "٠".charCodeAt(0)))
    .replace(PERSIAN_DIGITS, (digit) => String(digit.charCodeAt(0) - "۰".charCodeAt(0)))
    .toLocaleLowerCase("ar");
}

function normalizeSearchValue(value) {
  return typeof value === "string" ? normalizeArabicSearch(value) : "";
}

function sourceText(entry) {
  const source = entry?.sourceApp ?? entry?.source;
  if (typeof source === "string") {
    return source;
  }
  if (!source || typeof source !== "object") {
    return "";
  }
  return [source.executable, source.app, source.name, source.process, source.processName]
    .filter((value) => typeof value === "string")
    .join(" ");
}

function buildSearchIndex(entries) {
  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.map((entry) => {
    const fields = {
      text: entry?.type === "text" ? entry.text || "" : "",
      ocrText: typeof entry?.ocrText === "string" ? entry.ocrText : "",
      tags: Array.isArray(entry?.tags) ? entry.tags.join(" ") : "",
      title: typeof entry?.title === "string" ? entry.title : "",
      domain: typeof entry?.domain === "string" ? entry.domain : "",
      source: sourceText(entry),
      note: typeof entry?.note === "string" ? entry.note : ""
    };
    const normalizedFields = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, normalizeSearchValue(value)])
    );

    return {
      entry,
      fields,
      normalizedFields,
      normalizedCombined: normalizeSearchValue(Object.values(fields).join(" ")),
      normalizedText: normalizedFields.text,
      normalizedTags: normalizedFields.tags,
      normalizedTitle: normalizedFields.title,
      normalizedDomain: normalizedFields.domain,
      normalizedSource: normalizedFields.source
    };
  });
}

function normalizedRanges(original, normalizedNeedle) {
  if (typeof original !== "string" || !normalizedNeedle) {
    return [];
  }

  let normalizedText = "";
  const map = [];
  let sourceOffset = 0;
  for (const character of original) {
    const normalizedCharacter = normalizeSearchValue(character);
    for (const normalizedUnit of normalizedCharacter) {
      normalizedText += normalizedUnit;
      map.push({ start: sourceOffset, end: sourceOffset + character.length });
    }
    sourceOffset += character.length;
  }

  const ranges = [];
  let searchOffset = 0;
  while (searchOffset < normalizedText.length && ranges.length < MAX_HIGHLIGHT_RANGES) {
    const matchOffset = normalizedText.indexOf(normalizedNeedle, searchOffset);
    if (matchOffset < 0) {
      break;
    }
    const lastMapIndex = matchOffset + normalizedNeedle.length - 1;
    if (map[matchOffset] && map[lastMapIndex]) {
      ranges.push({ start: map[matchOffset].start, end: map[lastMapIndex].end });
    }
    searchOffset = matchOffset + Math.max(1, normalizedNeedle.length);
  }
  return ranges;
}

function dedupeRanges(ranges) {
  const seen = new Set();
  return ranges.filter((range) => {
    const key = `${range.start}:${range.end}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).sort((left, right) => left.start - right.start || left.end - right.end);
}

function evaluateTerm(indexed, node) {
  const term = normalizeSearchValue(node.value);
  if (!term) {
    return { matched: true, score: 0, ranges: [] };
  }

  const weights = { text: 10, ocrText: 9, tags: 8, title: 7, domain: 6, source: 3, note: 4 };
  let score = 0;
  let ranges = [];
  Object.entries(indexed.normalizedFields).forEach(([field, normalizedValue]) => {
    const matchOffset = normalizedValue.indexOf(term);
    if (matchOffset < 0) {
      return;
    }
    score += weights[field] || 1;
    if (matchOffset === 0) {
      score += 2;
    }
    if (normalizedValue === term) {
      score += 3;
    }
    if (field === "text") {
      ranges = normalizedRanges(indexed.fields[field], term);
    }
  });

  return { matched: score > 0, score, ranges };
}

function evaluateRegex(indexed, node) {
  let highestScore = 0;
  let ranges = [];
  const weights = { text: 10, ocrText: 9, tags: 8, title: 7, domain: 6, source: 3, note: 4 };

  Object.entries(indexed.fields).forEach(([field, value]) => {
    try {
      const regex = new RegExp(node.pattern, node.flags);
      if (regex.test(value)) {
        highestScore = Math.max(highestScore, weights[field] || 1);
        if (field === "text") {
          const match = value.match(new RegExp(node.pattern, node.flags.replace("g", "")));
          if (match && typeof match.index === "number") {
            ranges = [{ start: match.index, end: match.index + match[0].length }];
          }
        }
      }
    } catch (regexError) {
      if (!(regexError instanceof SyntaxError)) {
        throw regexError;
      }
    }
  });
  return { matched: highestScore > 0, score: highestScore, ranges };
}

function evaluateSearchNode(indexed, node) {
  if (!node) {
    return { matched: true, score: 0, ranges: [] };
  }
  if (node.type === "AND") {
    const left = evaluateSearchNode(indexed, node.left);
    const right = evaluateSearchNode(indexed, node.right);
    return left.matched && right.matched
      ? { matched: true, score: left.score + right.score, ranges: dedupeRanges([...left.ranges, ...right.ranges]) }
      : { matched: false, score: 0, ranges: [] };
  }
  if (node.type === "OR") {
    const left = evaluateSearchNode(indexed, node.left);
    const right = evaluateSearchNode(indexed, node.right);
    if (!left.matched && !right.matched) {
      return { matched: false, score: 0, ranges: [] };
    }
    const winner = left.score >= right.score ? left : right;
    return { matched: true, score: Math.max(left.score, right.score), ranges: winner.ranges };
  }
  if (node.type === "NOT") {
    const result = evaluateSearchNode(indexed, node.operand);
    return { matched: !result.matched, score: 0, ranges: [] };
  }
  if (node.type === "TERM" || node.type === "PHRASE") {
    return evaluateTerm(indexed, node);
  }
  if (node.type === "REGEX") {
    return evaluateRegex(indexed, node);
  }
  return { matched: false, score: 0, ranges: [] };
}

function evaluateSearch(entry, queryAst, context = {}) {
  if (!queryAst) {
    return { matched: true, score: 0, ranges: [] };
  }
  const indexed = context.indexed || buildSearchIndex([entry])[0];
  const result = evaluateSearchNode(indexed, queryAst);
  const now = Number.isFinite(context.now) ? context.now : Date.now();
  const createdAt = Number.isFinite(entry?.createdAt) ? entry.createdAt : now;
  const age = now - createdAt;
  if (result.matched && age >= 0 && age < 30 * 24 * 60 * 60 * 1000) {
    result.score += (1 - age / (30 * 24 * 60 * 60 * 1000)) * 2;
  }
  return result;
}

module.exports = {
  buildSearchIndex,
  evaluateSearch,
  normalizeArabicSearch,
  normalizeSearchValue,
  normalizedRanges
};
