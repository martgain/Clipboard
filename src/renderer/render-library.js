export function renderLibrary(state, renderList) {
  return renderLibraryIncremental(state, renderList);
}

export function renderLibraryIncremental(state, renderList) {
  renderList("pinned", state.pinned);
  renderList("normal", state.normal);

  return {
    pinnedCount: state.pinned.length,
    normalCount: state.normal.length
  };
}

renderLibrary.incremental = renderLibraryIncremental;
