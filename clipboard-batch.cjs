function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertBatchArguments(clipboardText, separator) {
  if (typeof clipboardText !== "string" || typeof separator !== "string" || separator.length === 0) {
    throw new TypeError("Clipboard text and separator must be valid strings");
  }
}

function removeSeparatorBoundaryLineEnding(segment) {
  if (segment.endsWith("\r\n")) {
    return segment.slice(0, -2);
  }

  return segment.endsWith("\n") ? segment.slice(0, -1) : segment;
}

function splitClipboardBatch(clipboardText, separator) {
  assertBatchArguments(clipboardText, separator);

  const separatorLine = new RegExp(`^${escapeRegExp(separator)}(?:\\r\\n|\\n|$)`, "gm");
  const segments = [];
  let segmentStart = 0;

  for (const match of clipboardText.matchAll(separatorLine)) {
    const segment = removeSeparatorBoundaryLineEnding(clipboardText.slice(segmentStart, match.index));
    if (segment.length > 0) {
      segments.push(segment);
    }
    segmentStart = match.index + match[0].length;
  }

  const trailingSegment = clipboardText.slice(segmentStart);
  if (trailingSegment.length > 0) {
    segments.push(trailingSegment);
  }

  return segments;
}

function joinClipboardBatch(clipboardItems, separator) {
  if (!Array.isArray(clipboardItems) || !clipboardItems.every((clipboardItem) => typeof clipboardItem === "string") || typeof separator !== "string" || separator.length === 0) {
    throw new TypeError("Clipboard items and separator are required");
  }

  return clipboardItems
    .filter((clipboardItem) => clipboardItem.length > 0)
    .join(`\n${separator}\n`);
}

module.exports = {
  joinClipboardBatch,
  splitClipboardBatch
};
