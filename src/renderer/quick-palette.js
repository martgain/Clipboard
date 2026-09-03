function normalizeText(searchText) {
  return typeof searchText === "string" ? searchText.normalize("NFKC").toLocaleLowerCase() : "";
}

function entrySearchText(entry) {
  return normalizeText([
    entry?.text,
    entry?.content,
    ...(Array.isArray(entry?.tags) ? entry.tags : []),
    entry?.sourceApp
  ].filter((searchPart) => typeof searchPart === "string").join(" "));
}

export function getCopyPayload(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  if (entry.type === "image") {
    return createImageCopyPayload(entry);
  }

  return {
    type: entry.type || "text",
    text: typeof entry.text === "string" ? entry.text : typeof entry.content === "string" ? entry.content : ""
  };
}

function createImageCopyPayload(entry) {
  const imagePayload = { type: "image" };
  if (entry.image !== undefined) {
    imagePayload.image = entry.image;
  }
  if (entry.mediaKey !== undefined) {
    imagePayload.mediaKey = entry.mediaKey;
  }
  return imagePayload;
}

export function filterPaletteEntries(entries, query = "") {
  if (!Array.isArray(entries)) {
    return [];
  }
  const normalizedQuery = normalizeText(query).trim();
  return entries.filter((entry) => !normalizedQuery || entrySearchText(entry).includes(normalizedQuery));
}

export class QuickPalette {
  constructor(options = {}) {
    const config = typeof options === "function"
      ? { copy: options }
      : options && typeof options === "object"
        ? options
        : {};
    this.copy = resolveCopyCallback(config);
    this.paste = typeof config.paste === "function" ? config.paste : null;
    this.onClose = typeof config.onClose === "function" ? config.onClose : null;
    this.autoPaste = config.autoPaste === true;
    this.entries = Array.isArray(config.entries) ? config.entries : Array.isArray(config.items) ? config.items : [];
    this.query = "";
    this.activeIndex = 0;
    this.isOpen = false;
  }

  static create(options) {
    return new QuickPalette(options);
  }

  getResults() {
    return filterPaletteEntries(this.entries, this.query);
  }

  getState() {
    const visibleEntries = this.getResults();
    const activeIndex = visibleEntries.length === 0 ? 0 : Math.min(this.activeIndex, visibleEntries.length - 1);
    return Object.freeze({
      open: this.isOpen,
      query: this.query,
      items: Object.freeze([...visibleEntries]),
      results: Object.freeze([...visibleEntries]),
      activeIndex,
      activeItem: visibleEntries[activeIndex] || null
    });
  }

  open(entries) {
    this.updateFromOpenInput(entries);
    this.isOpen = true;
    this.activeIndex = 0;
    return this.getState();
  }

  updateFromOpenInput(openInput) {
    if (Array.isArray(openInput)) {
      this.entries = openInput;
      return;
    }
    if (!openInput || typeof openInput !== "object") {
      return;
    }
    this.entries = Array.isArray(openInput.items)
      ? openInput.items
      : Array.isArray(openInput.entries)
        ? openInput.entries
        : this.entries;
    if (typeof openInput.query === "string") {
      this.query = openInput.query;
    }
  }

  close() {
    this.isOpen = false;
    const state = this.getState();
    if (this.onClose) {
      this.onClose(state);
    }
    return state;
  }

  setQuery(query) {
    this.query = typeof query === "string" ? query : "";
    this.activeIndex = 0;
    return this.getState();
  }

  moveSelection(delta) {
    const items = this.getResults();
    if (items.length === 0) {
      this.activeIndex = 0;
      return this.getState();
    }

    const step = Number.isFinite(delta) ? Math.trunc(delta) : 0;
    this.activeIndex = (this.activeIndex + step + items.length) % items.length;
    return this.getState();
  }

  select(index) {
    const items = this.getResults();
    if (Number.isInteger(index) && index >= 0 && index < items.length) {
      this.activeIndex = index;
    }
    return this.getState();
  }

  async activate(selection = this.activeIndex) {
    const items = this.getResults();
    const selectedIndex = resolveSelectionIndex(items, selection, this.activeIndex);
    const selectedEntry = items[selectedIndex];
    if (!selectedEntry) {
      return Object.freeze({ item: null, payload: null, copied: false, pasted: false });
    }

    const payload = getCopyPayload(selectedEntry);
    try {
      await this.copy(selectedEntry, payload);
      let pasted = false;
      if (this.autoPaste && this.paste) {
        await this.paste(selectedEntry, payload);
        pasted = true;
      }
      this.close();
      return Object.freeze({ item: selectedEntry, payload, copied: true, pasted });
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
      return Object.freeze({ item: selectedEntry, payload, copied: false, pasted: false, error });
    }
  }

  async handleKey(input) {
    const event = input && typeof input === "object" ? input : null;
    const key = event ? event.key : input;
    preventPaletteDefault(event, key);
    return dispatchPaletteKey(this, key);
  }
}

function resolveCopyCallback(config) {
  if (typeof config.copy === "function") {
    return config.copy;
  }
  if (typeof config.onCopy === "function") {
    return config.onCopy;
  }
  if (typeof config.writeClipboard === "function") {
    return config.writeClipboard;
  }
  return async () => undefined;
}

function resolveSelectionIndex(entries, selection, fallbackIndex) {
  if (Number.isInteger(selection)) {
    return selection;
  }
  const selectedId = typeof selection === "string" ? selection : selection?.id;
  const selectedIndex = entries.findIndex((entry) => entry?.id === selectedId);
  return selectedIndex >= 0 ? selectedIndex : fallbackIndex;
}

function preventPaletteDefault(event, key) {
  if (["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"].includes(key)) {
    event?.preventDefault?.();
  }
}

async function dispatchPaletteKey(palette, key) {
    switch (key) {
      case "ArrowDown":
        return palette.moveSelection(1);
      case "ArrowUp":
        return palette.moveSelection(-1);
      case "Home":
        return palette.select(0);
      case "End":
        return palette.select(Math.max(0, palette.getResults().length - 1));
      case "Enter":
        return palette.activate();
      case "Escape":
        return palette.close();
      default:
        return palette.getState();
    }
  }

export function createQuickPalette(options) {
  return new QuickPalette(options);
}

export function openQuickPalette(entries, options = {}) {
  const palette = new QuickPalette(options);
  palette.open(entries);
  return palette;
}
