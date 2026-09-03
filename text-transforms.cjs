const BULLET_LINE = /^(\s*)[-*•]\s+(.*)$/;
const NUMBERED_LINE = /^(\s*)\d+[.)]\s+(.*)$/;
const OPEN_QUOTE_CONTEXT = /[\s([{—–"'“‘]/;

function cleanupWhitespace(text, options) {
  const collapseSpaces = options.collapseSpaces === true;

  return text
    .split(/\r\n|\r|\n/)
    .map((line) => {
      if (line.trim() === "") {
        return "";
      }

      const [leading] = line.match(/^[ \t]*/);
      let rest = line.slice(leading.length).replace(/[ \t]+$/, "");

      if (collapseSpaces) {
        rest = rest.replace(/ {2,}/g, " ");
      }

      return `${leading}${rest}`;
    })
    .join("\n");
}

function isOpenQuoteContext(previousChar) {
  return previousChar === undefined || OPEN_QUOTE_CONTEXT.test(previousChar);
}

function toSmartQuotes(text) {
  let result = "";

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const previousChar = index > 0 ? text[index - 1] : undefined;

    if (character === "\"") {
      result += isOpenQuoteContext(previousChar) ? "“" : "”";
    } else if (character === "'") {
      result += isOpenQuoteContext(previousChar) ? "‘" : "’";
    } else {
      result += character;
    }
  }

  return result;
}

function straightenQuotes(text) {
  return text
    .replace(/[“”„‟]/g, "\"")
    .replace(/[‘’‚‛]/g, "'");
}

function convertBulletsToNumbered(text) {
  let counter = 0;

  return text
    .split(/\r\n|\r|\n/)
    .map((line) => {
      const match = line.match(BULLET_LINE);

      if (!match) {
        counter = 0;
        return line;
      }

      counter += 1;
      const [, indent, content] = match;
      return `${indent}${counter}. ${content}`;
    })
    .join("\n");
}

function convertNumberedToBullets(text) {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => {
      const match = line.match(NUMBERED_LINE);

      if (!match) {
        return line;
      }

      const [, indent, content] = match;
      return `${indent}- ${content}`;
    })
    .join("\n");
}

const OPERATIONS = new Map([
  ["whitespace-cleanup", (text, options) => cleanupWhitespace(text, options)],
  ["uppercase", (text) => text.toUpperCase()],
  ["lowercase", (text) => text.toLowerCase()],
  ["quotes-straighten", (text) => straightenQuotes(text)],
  ["quotes-smart", (text) => toSmartQuotes(text)],
  ["bullets-to-numbered", (text) => convertBulletsToNumbered(text)],
  ["numbered-to-bullets", (text) => convertNumberedToBullets(text)]
]);

const SUPPORTED_OPERATIONS = Array.from(OPERATIONS.keys());
const DEFAULT_PREVIEW_LENGTH = 4000;

function isSupportedOperation(operation) {
  return typeof operation === "string" && OPERATIONS.has(operation);
}

function transformText(text, operation, options = {}) {
  if (typeof text !== "string") {
    throw new TypeError("Text must be a string");
  }

  if (!isSupportedOperation(operation)) {
    throw new RangeError(`Unsupported text transform operation: ${operation}`);
  }

  const handler = OPERATIONS.get(operation);
  const safeOptions = options && typeof options === "object" ? options : {};
  const transformed = handler(text, safeOptions);

  return {
    text: transformed,
    operation,
    sourceLength: text.length
  };
}

function transformPreview(text, operation, options = {}) {
  const safeOptions = options && typeof options === "object" ? options : {};
  const result = transformText(text, operation, safeOptions);
  const previewLength = Number.isInteger(safeOptions.previewLength) && safeOptions.previewLength > 0
    ? safeOptions.previewLength
    : DEFAULT_PREVIEW_LENGTH;

  const before = text.length > previewLength ? `${text.slice(0, previewLength)}…` : text;
  const after = result.text.length > previewLength ? `${result.text.slice(0, previewLength)}…` : result.text;

  return { before, after, changed: result.text !== text };
}

module.exports = {
  transformText,
  transformPreview,
  isSupportedOperation,
  SUPPORTED_OPERATIONS
};
