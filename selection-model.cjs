function orderSelectedIds(selectedIds, orderedIds) {
  const selectedIdSet = new Set(selectedIds);
  return orderedIds.filter((cardId) => selectedIdSet.has(cardId));
}

function getInclusiveRange(anchorId, clickedId, orderedIds) {
  const anchorIndex = orderedIds.indexOf(anchorId);
  const clickedIndex = orderedIds.indexOf(clickedId);

  if (anchorIndex < 0 || clickedIndex < 0) {
    return null;
  }

  const rangeStart = Math.min(anchorIndex, clickedIndex);
  const rangeEnd = Math.max(anchorIndex, clickedIndex);
  return orderedIds.slice(rangeStart, rangeEnd + 1);
}

function updateSelection({ selectedIds, anchorId, clickedId, orderedIds, ctrlKey, shiftKey }) {
  const range = shiftKey ? getInclusiveRange(anchorId, clickedId, orderedIds) : null;

  if (range) {
    const nextSelectedIds = ctrlKey ? new Set(selectedIds) : new Set();
    range.forEach((cardId) => nextSelectedIds.add(cardId));
    return { selectedIds: orderSelectedIds(nextSelectedIds, orderedIds), anchorId };
  }

  if (ctrlKey) {
    const nextSelectedIds = new Set(selectedIds);
    if (nextSelectedIds.has(clickedId)) {
      nextSelectedIds.delete(clickedId);
    } else {
      nextSelectedIds.add(clickedId);
    }
    return { selectedIds: orderSelectedIds(nextSelectedIds, orderedIds), anchorId: clickedId };
  }

  return { selectedIds: orderedIds.includes(clickedId) ? [clickedId] : [], anchorId: clickedId };
}

module.exports = {
  updateSelection
};
