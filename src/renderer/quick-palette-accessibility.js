export function quickPaletteOptionId(entry, index) {
  const rawId = typeof entry?.id === "string" && entry.id ? entry.id : `index-${index}`;
  const safeId = rawId.normalize("NFKC").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || `index-${index}`;
  return `quick-palette-option-${safeId}`;
}

export function quickPaletteActiveDescendant(entries, activeIndex) {
  return Array.isArray(entries) && entries[activeIndex]
    ? quickPaletteOptionId(entries[activeIndex], activeIndex)
    : "";
}

export function restoreQuickPaletteFocus(element) {
  if (!element?.isConnected || typeof element.focus !== "function") {
    return false;
  }
  element.focus({ preventScroll: true });
  return true;
}

export function syncQuickPaletteAccessibility(searchInput, listbox, entries, activeIndex) {
  const activeId = quickPaletteActiveDescendant(entries, activeIndex);
  searchInput.setAttribute("aria-activedescendant", activeId);
  if (!activeId) return activeId;
  listbox.querySelector(`#${activeId}`)?.scrollIntoView({ block: "nearest" });
  return activeId;
}
