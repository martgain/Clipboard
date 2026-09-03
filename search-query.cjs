const DEFAULT_MAX_QUERY_LENGTH = 500;
const DEFAULT_MAX_REGEX_LENGTH = 100;
const REGEX_FLAGS = /^[gimsuy]*$/;

function parseSearchQuery(input, options = {}) {
  const maxQueryLength = Number.isSafeInteger(options.maxLength) && options.maxLength > 0
    ? options.maxLength
    : DEFAULT_MAX_QUERY_LENGTH;
  const maxRegexLength = Number.isSafeInteger(options.maxRegexLength) && options.maxRegexLength > 0
    ? options.maxRegexLength
    : DEFAULT_MAX_REGEX_LENGTH;

  if (typeof input !== "string" || input.trim().length === 0) {
    return { ast: null, error: null };
  }
  if (input.length > maxQueryLength) {
    return { ast: null, error: "Query exceeds maximum length" };
  }

  const tokenResult = tokenize(input, maxRegexLength);
  if (tokenResult.error) {
    return { ast: null, error: tokenResult.error };
  }

  const tokens = tokenResult.tokens;
  let position = 0;

  function peek() {
    return tokens[position] || null;
  }

  function consume(type) {
    if (peek()?.type !== type) {
      return null;
    }
    return tokens[position++];
  }

  function startsOperand(token) {
    return token && ["TERM", "PHRASE", "REGEX", "NOT"].includes(token.type);
  }

  function parsePrimary() {
    const token = peek();
    if (!token || !["TERM", "PHRASE", "REGEX"].includes(token.type)) {
      return null;
    }
    position += 1;
    return token;
  }

  function parseUnary() {
    if (consume("NOT")) {
      const operand = parseUnary();
      return operand ? { type: "NOT", operand } : null;
    }
    return parsePrimary();
  }

  function parseAnd() {
    let left = parseUnary();
    if (!left) {
      return null;
    }

    while (true) {
      if (consume("AND")) {
        const right = parseUnary();
        if (!right) {
          return null;
        }
        left = { type: "AND", left, right };
        continue;
      }
      if (startsOperand(peek())) {
        const right = parseUnary();
        if (!right) {
          return null;
        }
        left = { type: "AND", left, right };
        continue;
      }
      break;
    }
    return left;
  }

  function parseOr() {
    let left = parseAnd();
    if (!left) {
      return null;
    }

    while (consume("OR")) {
      const right = parseAnd();
      if (!right) {
        return null;
      }
      left = { type: "OR", left, right };
    }
    return left;
  }

  const ast = parseOr();
  if (!ast || position !== tokens.length) {
    return { ast: null, error: "Search query operator is incomplete" };
  }
  return { ast, error: null };
}

function tokenize(input, maxRegexLength) {
  const tokens = [];
  let position = 0;

  while (position < input.length) {
    if (/\s/.test(input[position])) {
      position += 1;
      continue;
    }

    if (input[position] === '"') {
      const end = input.indexOf('"', position + 1);
      if (end < 0) {
        return { tokens: [], error: "Unclosed phrase" };
      }
      tokens.push({ type: "PHRASE", value: input.slice(position + 1, end) });
      position = end + 1;
      continue;
    }

    if (input[position] === "/") {
      const regexEnd = findRegexEnd(input, position + 1);
      if (regexEnd < 0) {
        return { tokens: [], error: "Unclosed regex literal" };
      }
      const pattern = input.slice(position + 1, regexEnd);
      if (pattern.length > maxRegexLength) {
        return { tokens: [], error: "Regex pattern exceeds maximum length" };
      }

      let flags = "";
      position = regexEnd + 1;
      while (position < input.length && /[a-z]/i.test(input[position])) {
        flags += input[position];
        position += 1;
      }
      if (!REGEX_FLAGS.test(flags)) {
        return { tokens: [], error: "Unsupported regex flags" };
      }
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
    while (position < input.length && !/\s/.test(input[position]) && !["\"", "/"].includes(input[position])) {
      position += 1;
    }
    const word = input.slice(start, position);
    const upperWord = word.toLocaleUpperCase("en-US");
    if (upperWord === "AND") {
      tokens.push({ type: "AND" });
    } else if (upperWord === "OR") {
      tokens.push({ type: "OR" });
    } else if (upperWord === "NOT" || word === "-") {
      tokens.push({ type: "NOT" });
    } else if (word.startsWith("-") && word.length > 1) {
      tokens.push({ type: "NOT" }, { type: "TERM", value: word.slice(1) });
    } else {
      tokens.push({ type: "TERM", value: word });
    }
  }

  return { tokens, error: null };
}

function findRegexEnd(input, start) {
  let escaped = false;
  for (let position = start; position < input.length; position += 1) {
    if (escaped) {
      escaped = false;
    } else if (input[position] === "\\") {
      escaped = true;
    } else if (input[position] === "/") {
      return position;
    }
  }
  return -1;
}

module.exports = { parseSearchQuery };
