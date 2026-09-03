const MAX_SEQUENCE_ENTRIES = 150;
const MAX_ENTRY_TEXT_LENGTH = 100000;
const MAX_SEQUENCE_TEXT_LENGTH = 1000000;
const MAX_SEPARATOR_LENGTH = 80;
const DEFAULT_SEPARATOR = "\n";

function assertSequenceEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("Paste sequence entries must be an array");
  }

  if (entries.length > MAX_SEQUENCE_ENTRIES) {
    throw new RangeError(`Paste sequence cannot contain more than ${MAX_SEQUENCE_ENTRIES} entries`);
  }
}

function normalizeOptions(options) {
  if (options === undefined) {
    return { separator: DEFAULT_SEPARATOR, order: undefined };
  }

  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Paste sequence options must be an object");
  }

  const separator = options.separator === undefined ? DEFAULT_SEPARATOR : options.separator;
  assertSeparator(separator);
  const order = options.order;
  assertOrder(order);
  return { separator, order };
}

function assertSeparator(separator) {
  if (typeof separator !== "string" || separator.length === 0 || separator.length > MAX_SEPARATOR_LENGTH) {
    throw new TypeError("Paste sequence separator is invalid");
  }
}

function assertOrder(order) {
  if (order !== undefined && (!Array.isArray(order) || order.length > MAX_SEQUENCE_ENTRIES)) {
    throw new TypeError("Paste sequence order is invalid");
  }
}

function readEntry(entry, index) {
  if (typeof entry === "string") {
    return { id: String(index), index, text: entry };
  }

  if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.text !== "string") {
    throw new TypeError("Each paste sequence entry must contain text");
  }

  if (entry.id !== undefined && (typeof entry.id !== "string" || entry.id.length === 0)) {
    throw new TypeError("Paste sequence entry id is invalid");
  }

  return {
    id: entry.id,
    index,
    text: entry.text
  };
}

function assertTextBounds(text) {
  if (text.length > MAX_ENTRY_TEXT_LENGTH) {
    throw new RangeError(`Paste sequence entry text cannot exceed ${MAX_ENTRY_TEXT_LENGTH} characters`);
  }
}

function prepareEntries(entries) {
  const prepared = entries.map((entry, index) => {
    const normalized = readEntry(entry, index);
    assertTextBounds(normalized.text);
    return normalized;
  });
  assertUniqueEntryIds(prepared);
  return prepared;
}

function assertUniqueEntryIds(prepared) {
  const ids = new Set();

  prepared.forEach((entry) => {
    if (entry.id !== undefined) {
      if (ids.has(entry.id)) {
        throw new TypeError("Paste sequence entry ids must be unique");
      }
      ids.add(entry.id);
    }
  });
}

function selectEntries(prepared, order) {
  if (order === undefined) {
    return prepared;
  }

  const entriesById = createEntryIndex(prepared);
  const selectedIndexes = new Set();

  return order.map((selector) => {
    const entry = Number.isInteger(selector)
      ? prepared[selector]
      : entriesById.get(selector);
    assertSelectedEntry(entry, selectedIndexes);
    selectedIndexes.add(entry.index);
    return entry;
  });
}

function createEntryIndex(prepared) {
  return new Map(prepared
    .filter((entry) => entry.id !== undefined)
    .map((entry) => [entry.id, entry]));
}

function assertSelectedEntry(entry, selectedIndexes) {
  if (!entry) {
    throw new TypeError("Paste sequence order references an unknown entry");
  }

  if (selectedIndexes.has(entry.index)) {
    throw new TypeError("Paste sequence order must not repeat an entry");
  }
}

function splitPasteSequence(entries, options) {
  assertSequenceEntries(entries);
  const { order } = normalizeOptions(options);

  return selectEntries(prepareEntries(entries), order)
    .filter((entry) => entry.text.length > 0)
    .map((entry) => entry.text);
}

function buildPasteSequence(entries, options) {
  assertSequenceEntries(entries);
  const normalizedOptions = normalizeOptions(options);
  const sequenceEntries = splitPasteSequence(entries, normalizedOptions);
  const text = sequenceEntries.join(normalizedOptions.separator);

  if (text.length > MAX_SEQUENCE_TEXT_LENGTH) {
    throw new RangeError(`Paste sequence text cannot exceed ${MAX_SEQUENCE_TEXT_LENGTH} characters`);
  }

  return {
    text,
    entries: sequenceEntries.slice(),
    separator: normalizedOptions.separator
  };
}

module.exports = {
  buildPasteSequence,
  splitPasteSequence
};
