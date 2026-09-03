const DEFAULT_NORMAL_LIMIT = 150;

function parseSearchQuery(input, options = {}) {
  const maxQueryLength = Number.isSafeInteger(options.maxLength) && options.maxLength > 0 ? options.maxLength : 500;
  const maxRegexLength = Number.isSafeInteger(options.maxRegexLength) && options.maxRegexLength > 0 ? options.maxRegexLength : 100;
  if (typeof input !== "string" || input.trim().length === 0) return { ast: null, error: null };
  if (input.length > maxQueryLength) return { ast: null, error: "Query exceeds maximum length" };

  const tokenResult = tokenizeSearchQuery(input, maxRegexLength);
  if (tokenResult.error) return { ast: null, error: tokenResult.error };
  const tokens = tokenResult.tokens;
  let position = 0;
  const peek = () => tokens[position] || null;
  const consume = (type) => peek()?.type === type ? tokens[position++] : null;
  const startsOperand = (token) => token && ["TERM", "PHRASE", "REGEX", "NOT"].includes(token.type);
  const parsePrimary = () => {
    const token = peek();
    if (!token || !["TERM", "PHRASE", "REGEX"].includes(token.type)) return null;
    position += 1;
    return token;
  };
  const parseUnary = () => {
    if (consume("NOT")) {
      const operand = parseUnary();
      return operand ? { type: "NOT", operand } : null;
    }
    return parsePrimary();
  };
  const parseAnd = () => {
    let left = parseUnary();
    if (!left) return null;
    while (true) {
      if (consume("AND")) {
        const right = parseUnary();
        if (!right) return null;
        left = { type: "AND", left, right };
        continue;
      }
      if (startsOperand(peek())) {
        const right = parseUnary();
        if (!right) return null;
        left = { type: "AND", left, right };
        continue;
      }
      return left;
    }
  };
  const parseOr = () => {
    let left = parseAnd();
    if (!left) return null;
    while (consume("OR")) {
      const right = parseAnd();
      if (!right) return null;
      left = { type: "OR", left, right };
    }
    return left;
  };
  const ast = parseOr();
  return !ast || position !== tokens.length
    ? { ast: null, error: "Search query operator is incomplete" }
    : { ast, error: null };
}

function tokenizeSearchQuery(input, maxRegexLength) {
  const tokens = [];
  let position = 0;
  while (position < input.length) {
    if (/\s/.test(input[position])) {
      position += 1;
      continue;
    }
    if (input[position] === '"') {
      const end = input.indexOf('"', position + 1);
      if (end < 0) return { tokens: [], error: "Unclosed phrase" };
      tokens.push({ type: "PHRASE", value: input.slice(position + 1, end) });
      position = end + 1;
      continue;
    }
    if (input[position] === "/") {
      const end = findSearchRegexEnd(input, position + 1);
      if (end < 0) return { tokens: [], error: "Unclosed regex literal" };
      const pattern = input.slice(position + 1, end);
      if (pattern.length > maxRegexLength) return { tokens: [], error: "Regex pattern exceeds maximum length" };
      position = end + 1;
      let flags = "";
      while (position < input.length && /[a-z]/i.test(input[position])) flags += input[position++];
      if (!/^[gimsuy]*$/.test(flags)) return { tokens: [], error: "Unsupported regex flags" };
      try {
        new RegExp(pattern, flags);
      } catch (regexError) {
        if (!(regexError instanceof SyntaxError)) {
          throw regexError;
        }
        return { tokens: [], error: "Invalid regex literal" };
      }
      tokens.push({ type: "REGEX", pattern, flags });
      continue;
    }
    const start = position;
    while (position < input.length && !/\s/.test(input[position]) && !["\"", "/"].includes(input[position])) position += 1;
    const word = input.slice(start, position);
    const upperWord = word.toLocaleUpperCase("en-US");
    if (upperWord === "AND") tokens.push({ type: "AND" });
    else if (upperWord === "OR") tokens.push({ type: "OR" });
    else if (upperWord === "NOT" || word === "-") tokens.push({ type: "NOT" });
    else if (word.startsWith("-") && word.length > 1) tokens.push({ type: "NOT" }, { type: "TERM", value: word.slice(1) });
    else tokens.push({ type: "TERM", value: word });
  }
  return { tokens, error: null };
}

function findSearchRegexEnd(input, start) {
  let escaped = false;
  for (let position = start; position < input.length; position += 1) {
    if (escaped) escaped = false;
    else if (input[position] === "\\") escaped = true;
    else if (input[position] === "/") return position;
  }
  return -1;
}


function normalizeArabicSearch(value) {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ى]/g, 'ي')
    .replace(/[ة]/g, 'ه')
    .toLocaleLowerCase();
}

function normalizeSearchValue(value) {
  if (typeof value !== "string") return "";
  return normalizeArabicSearch(value.normalize("NFKC"));
}

function buildSearchIndex(entries) {
  return entries.map(entry => {
    let text = entry.type === "text" ? (entry.text || "") : "صورة";
    let ocrText = (entry.type === "image" && entry.ocrText) ? entry.ocrText : "";
    let tags = Array.isArray(entry.tags) ? entry.tags.join(" ") : "";
    let title = entry.title || "";
    let domain = entry.domain || "";
    let source = (entry.sourceApp && entry.sourceApp.executable) ? entry.sourceApp.executable : "";

    let combined = `${text} ${ocrText} ${tags} ${title} ${domain} ${source}`;

    return {
      entry,
      originalText: text,
      originalOcrText: ocrText,
      normalizedCombined: normalizeSearchValue(combined),
      normalizedText: normalizeSearchValue(text),
      normalizedOcrText: normalizeSearchValue(ocrText),
      normalizedTags: normalizeSearchValue(tags),
      normalizedTitle: normalizeSearchValue(title),
      normalizedDomain: normalizeSearchValue(domain),
      normalizedSource: normalizeSearchValue(source)
    };
  });
}

function evaluateSearchNode(entry, indexed, node) {
  if (!node) return { matched: true, score: 0, ranges: [] };

  if (node.type === "AND") {
    const left = evaluateSearchNode(entry, indexed, node.left);
    if (!left.matched) return { matched: false, score: 0, ranges: [] };
    const right = evaluateSearchNode(entry, indexed, node.right);
    if (!right.matched) return { matched: false, score: 0, ranges: [] };

    return {
      matched: true,
      score: left.score + right.score,
      ranges: [...left.ranges, ...right.ranges]
    };
  }

  if (node.type === "OR") {
    const left = evaluateSearchNode(entry, indexed, node.left);
    const right = evaluateSearchNode(entry, indexed, node.right);
    if (!left.matched && !right.matched) return { matched: false, score: 0, ranges: [] };

    return {
      matched: true,
      score: Math.max(left.score, right.score),
      ranges: [...(left.matched ? left.ranges : []), ...(right.matched ? right.ranges : [])]
    };
  }

  if (node.type === "NOT") {
    const operand = evaluateSearchNode(entry, indexed, node.operand);
    return {
      matched: !operand.matched,
      score: 0,
      ranges: []
    };
  }

  if (node.type === "TERM" || node.type === "PHRASE") {
    const term = normalizeSearchValue(node.value);
    if (!term) return { matched: true, score: 0, ranges: [] };

    let score = 0;
    const ranges = [];

    const textRange = findNormalizedRange(indexed.originalText, term);
    if (textRange) {
      score += 10;
      if (textRange.start === 0) score += 5;
      ranges.push(textRange);
    }

    if (indexed.normalizedOcrText.includes(term)) score += 9;

    if (indexed.normalizedTags.includes(term)) score += 8;
    if (indexed.normalizedTitle.includes(term)) score += 5;
    if (indexed.normalizedDomain.includes(term)) score += 5;
    if (indexed.normalizedSource.includes(term)) score += 3;

    if (score > 0) {
      return { matched: true, score, ranges };
    }

    return { matched: false, score: 0, ranges: [] };
  }

  if (node.type === "REGEX") {
    try {
      const regex = new RegExp(node.pattern, node.flags);
      const text = entry.text || "";
      const match = regex.exec(text);
      if (match) {
        return {
          matched: true,
          score: 10,
          ranges: [{ start: match.index, end: match.index + match[0].length }]
        };
      }
      const ocrRegex = new RegExp(node.pattern, node.flags);
      if (ocrRegex.test(indexed.originalOcrText)) {
        return { matched: true, score: 9, ranges: [] };
      }
    } catch (regexError) {
      if (!(regexError instanceof SyntaxError)) {
        throw regexError;
      }
    }
    return { matched: false, score: 0, ranges: [] };
  }

  return { matched: false, score: 0, ranges: [] };
}

function findNormalizedRange(originalText, normalizedTerm) {
  if (typeof originalText !== "string" || !normalizedTerm) return null;
  const normalizedParts = [];
  const originalOffsets = [];
  let offset = 0;
  for (const character of originalText) {
    const normalizedCharacter = normalizeSearchValue(character);
    for (const normalizedPart of normalizedCharacter) {
      normalizedParts.push(normalizedPart);
      originalOffsets.push({ start: offset, end: offset + character.length });
    }
    offset += character.length;
  }
  const normalizedText = normalizedParts.join("");
  const matchStart = normalizedText.indexOf(normalizedTerm);
  if (matchStart < 0) return null;
  const matchEnd = matchStart + normalizedTerm.length - 1;
  return {
    start: originalOffsets[matchStart].start,
    end: originalOffsets[matchEnd].end
  };
}

function evaluateSearch(entry, queryAst, context = {}) {
  if (!queryAst) {
    return { matched: true, score: 0, ranges: [] };
  }

  const indexed = buildSearchIndex([entry])[0];
  const result = evaluateSearchNode(entry, indexed, queryAst);

  if (result.matched) {
    const now = Date.now();
    const age = now - (entry.createdAt || now);
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    if (age < maxAge && age >= 0) {
      result.score += (1 - age / maxAge) * 2;
    }
  }

  return result;
}




export function filterLibraryEntries(entries, options = {}) {
  if (!Array.isArray(entries)) {
    return [];
  }

  const parsed = options.query ? parseSearchQuery(options.query) : { ast: null, error: null };
  if (parsed.error) {
    return [];
  }
  const ast = parsed.ast;
  const type = options.type === "text" || options.type === "image" ? options.type : "all";
  const tag = normalizeSearchValue(options.tag).trim();
  const source = normalizeSearchValue(options.source).trim();
  const dateFrom = parseSearchDate(options.dateFrom, -Infinity);
  const dateTo = parseSearchDate(options.dateTo, Infinity, true);

  let results = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || (type !== "all" && entry.type !== type)) {
      continue;
    }

    const executable = normalizeSearchValue(entry.sourceApp?.executable || entry.sourceApp?.name).trim();
    if (source && executable !== source) {
      continue;
    }

    const timestamp = Number.isFinite(entry.createdAt) ? entry.createdAt : entry.updatedAt;
    if (Number.isFinite(timestamp) && (timestamp < dateFrom || timestamp > dateTo)) {
      continue;
    }
    if (!Number.isFinite(timestamp) && (dateFrom !== -Infinity || dateTo !== Infinity)) {
      continue;
    }

    const entryTags = Array.isArray(entry.tags) ? entry.tags : [];
    if (tag && !entryTags.some((entryTag) => normalizeSearchValue(entryTag) === tag)) {
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

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.originalIndex - b.originalIndex;
  });

  if (options.includeMetadata !== true) {
    return results.map(({ entry }) => entry);
  }

  return results.map(r => {
    // Return original entry but attached search details
    const res = { ...r.entry };
    res.searchRanges = r.ranges;
    res.searchScore = r.score;
    return res;
  });
}

function parseSearchDate(value, fallback, inclusiveEnd = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) return fallback;
  return inclusiveEnd && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? timestamp + 86_400_000 - 1
    : timestamp;
}


function normalLimit(state) {
  return Number.isInteger(state.settings?.normalLimit)
    ? state.settings.normalLimit
    : DEFAULT_NORMAL_LIMIT;
}

function addEntry(state, action) {
  const targetList = action.targetList === "pinned" ? "pinned" : "normal";
  const nextPinned = state.pinned.filter((entry) => entry.id !== action.entry.id);
  const nextNormal = state.normal.filter((entry) => entry.id !== action.entry.id);

  if (targetList === "pinned") {
    nextPinned.unshift(action.entry);
  } else {
    nextNormal.unshift(action.entry);
  }

  return {
    ...state,
    pinned: nextPinned,
    normal: nextNormal.slice(0, normalLimit(state))
  };
}

function moveEntry(state, sourceList, targetList, action) {
  const sourceEntry = state[sourceList].find((entry) => entry.id === action.id);
  if (!sourceEntry) {
    return state;
  }

  const movedEntry = action.updatedAt === undefined
    ? sourceEntry
    : { ...sourceEntry, updatedAt: action.updatedAt };
  return {
    ...state,
    [sourceList]: state[sourceList].filter((entry) => entry.id !== action.id),
    [targetList]: [movedEntry, ...state[targetList]].slice(
      0,
      targetList === "normal" ? normalLimit(state) : undefined
    )
  };
}

function deleteEntry(state, action) {
  const listName = action.listName === "pinned" ? "pinned" : "normal";
  return {
    ...state,
    [listName]: state[listName].filter((entry) => entry.id !== action.id)
  };
}

export function appStateReducer(state, action) {
  switch (action.type) {
    case "entry/add":
      return addEntry(state, action);
    case "entry/pin":
      return moveEntry(state, "normal", "pinned", action);
    case "entry/unpin":
      return moveEntry(state, "pinned", "normal", action);
    case "entry/delete":
      return deleteEntry(state, action);
    case "search/set-query":
      return {
        ...state,
        settings: { ...state.settings, searchQuery: action.query }
      };
    default:
      return state;
  }
}

export class AppStateStore {
  constructor(initialState) {
    this.state = initialState;
  }

  getState() {
    return this.state;
  }

  replaceState(nextState) {
    this.state = nextState;
    return this.state;
  }

  dispatch(action) {
    this.state = appStateReducer(this.state, action);
    return this.state;
  }

  search(options = {}) {
    const query = options.query ?? this.state.settings.searchQuery;
    return filterLibraryEntries(
      [...this.state.pinned, ...this.state.normal],
      { ...options, query }
    );
  }
}
