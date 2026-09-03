const OCR_BIDI_MARKS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

function normalizeOcrLine(rawLine) {
  return rawLine
    .replace(OCR_BIDI_MARKS, "")
    .replace(/[\t \u00A0]+/g, " ")
    .trim();
}

function normalizeOcrText(rawText) {
  if (typeof rawText !== "string") {
    throw new TypeError("OCR output must be a string");
  }

  const trimmedText = rawText.replace(/\r\n?/g, "\n").trim();

  if (!trimmedText) {
    return "";
  }

  return trimmedText.split("\n").map(normalizeOcrLine).join("\n").trim();
}

function collectOcrLineRecords(blocks) {
  const lines = [];

  for (const block of Array.isArray(blocks) ? blocks : []) {
    for (const paragraph of Array.isArray(block?.paragraphs) ? block.paragraphs : []) {
      for (const line of Array.isArray(paragraph?.lines) ? paragraph.lines : []) {
        if (typeof line?.text === "string" && line.text.trim()) {
          lines.push(line);
        }
      }
    }
  }

  return lines;
}

function extractOcrTextFromBlocks(blocks) {
  const lineRecords = collectOcrLineRecords(blocks);
  const positionedLines = orderOcrLines(lineRecords);
  const orderedLines = positionedLines.length === lineRecords.length
    ? positionedLines
    : lineRecords;

  return normalizeOcrText(mergeOcrVisualRows(orderedLines).map((line) => line.text).join("\n"));
}

function isPositionedOcrLine(line) {
  return Boolean(line) && typeof line.text === "string"
    && Number.isFinite(line.bbox?.x0) && Number.isFinite(line.bbox?.y0);
}

function orderOcrLines(lines) {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines.filter(isPositionedOcrLine).slice().sort((firstLine, secondLine) => (
    firstLine.bbox.y0 - secondLine.bbox.y0
      || firstLine.bbox.x0 - secondLine.bbox.x0
  ));
}

function lineBottom(line) {
  return Number.isFinite(line.bbox?.y1) ? line.bbox.y1 : line.bbox.y0 + 1;
}

function lineHeight(line) {
  return Math.max(1, lineBottom(line) - line.bbox.y0);
}

function lineCenter(line) {
  return line.bbox.y0 + lineHeight(line) / 2;
}

function sameVisualRow(firstLine, secondLine) {
  const centerDistance = Math.abs(lineCenter(firstLine) - lineCenter(secondLine));
  const tolerance = Math.max(2, Math.min(lineHeight(firstLine), lineHeight(secondLine)) * 0.95);
  return centerDistance <= tolerance;
}

function isTimestampLine(text) {
  return /^(?:\d{1,2}[:.]\d{2}\s*(?:am|pm|ص|م)|\d{1,2}\s*(?:am|pm|ص|م))$/iu.test(text);
}

function normalizedLineText(line) {
  return normalizeOcrText(line.text).replace(/\n+/g, " ");
}

function combineLineText(firstText, secondText) {
  if (firstText === secondText || firstText.endsWith(` ${secondText}`)) {
    return firstText;
  }

  if (secondText.endsWith(` ${firstText}`)) {
    return secondText;
  }

  return `${firstText} ${secondText}`;
}

function mergeTimestampPair(firstLine, secondLine) {
  if (!sameVisualRow(firstLine, secondLine)) {
    return null;
  }

  const firstText = normalizedLineText(firstLine);
  const secondText = normalizedLineText(secondLine);

  if (!isTimestampLine(firstText) && isTimestampLine(secondText)) {
    return { ...firstLine, text: combineLineText(firstText, secondText) };
  }

  if (isTimestampLine(firstText) && !isTimestampLine(secondText)) {
    return { ...secondLine, text: combineLineText(secondText, firstText) };
  }

  return null;
}

function mergeVisualRowPair(firstLine, secondLine) {
  const timestampPair = mergeTimestampPair(firstLine, secondLine);
  if (timestampPair) {
    return timestampPair;
  }

  if (!sameVisualRow(firstLine, secondLine)) {
    return null;
  }

  return {
    ...firstLine,
    text: combineLineText(normalizedLineText(firstLine), normalizedLineText(secondLine))
  };
}

function mergeOcrVisualRows(lines) {
  const merged = [];

  for (let index = 0; index < lines.length; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];

    if (next && isPositionedOcrLine(current) && isPositionedOcrLine(next)) {
      const combinedLine = mergeVisualRowPair(current, next);
      if (combinedLine) {
        merged.push(combinedLine);
        index += 1;
        continue;
      }
    }

    merged.push({ ...current, text: normalizedLineText(current) });
  }

  return merged;
}

module.exports = {
  extractOcrTextFromBlocks,
  mergeOcrVisualRows,
  normalizeOcrText,
  orderOcrLines
};
