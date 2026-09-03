const DEFAULT_NORMAL_LIMIT = 150;

function listNames(state) {
  return [
    Array.isArray(state?.pinned) ? "pinned" : "pins",
    "normal"
  ].filter((name) => Array.isArray(state?.[name]));
}

function selectedRecords(state, selectedIds) {
  const requestedIds = Array.isArray(selectedIds) ? selectedIds : [];
  const entriesById = indexEntriesById(state);

  const seen = new Set();
  return requestedIds.flatMap((id) => {
    const selectedRecord = entriesById.get(id);
    if (!selectedRecord || seen.has(id)) {
      return [];
    }
    seen.add(id);
    return [selectedRecord];
  });
}

function indexEntriesById(state) {
  const entriesById = new Map();
  listNames(state).forEach((listName) => {
    state[listName].forEach((entry) => {
      if (entry && typeof entry.id === "string" && !entriesById.has(entry.id)) {
        entriesById.set(entry.id, { entry, listName });
      }
    });
  });
  return entriesById;
}

function copyListState(state) {
  const nextState = { ...state };
  listNames(state).forEach((listName) => {
    nextState[listName] = [...state[listName]];
  });
  return nextState;
}

function normalLimit(state) {
  return Number.isInteger(state?.settings?.normalLimit) && state.settings.normalLimit >= 0
    ? state.settings.normalLimit
    : DEFAULT_NORMAL_LIMIT;
}

function entryWithTags(entry, tags) {
  return { ...entry, tags: [...tags] };
}

function updateEntries(nextState, records, updater) {
  const updates = new Map(records.map(({ entry }) => [entry.id, updater(entry)]));
  listNames(nextState).forEach((listName) => {
    nextState[listName] = nextState[listName].map((entry) => updates.get(entry.id) || entry);
  });
}

function moveEntries(state, records, targetList) {
  const nextState = copyListState(state);
  const selectedIds = new Set(records.map(({ entry }) => entry.id));
  const selectedEntries = records.map(({ entry }) => entry);

  listNames(state).forEach((listName) => {
    nextState[listName] = nextState[listName].filter((entry) => !selectedIds.has(entry.id));
  });

  nextState[targetList] = prependEntries(nextState[targetList] || [], selectedEntries, targetList, state);
  return nextState;
}

function prependEntries(existingEntries, selectedEntries, targetList, state) {
  const movedEntries = [...selectedEntries, ...existingEntries];
  return targetList === "normal" ? movedEntries.slice(0, normalLimit(state)) : movedEntries;
}

function updateTags(state, records, action) {
  const requestedTags = normalizeRequestedTags(action);
  const mode = action.mode === "remove" || action.mode === "set" ? action.mode : "add";

  if (requestedTags.length === 0 && mode !== "set") {
    return state;
  }

  const requestedSet = new Set(requestedTags);
  const nextState = copyListState(state);
  updateEntries(nextState, records, (entry) => {
    return updateEntryTags(entry, requestedTags, requestedSet, mode);
  });
  return nextState;
}

function normalizeRequestedTags(action) {
  const candidateTags = Array.isArray(action.tags) ? action.tags : [action.tag];
  return candidateTags
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function updateEntryTags(entry, requestedTags, requestedSet, mode) {
  const currentTags = Array.isArray(entry.tags) ? entry.tags : [];
  if (mode === "set") {
    return entryWithTags(entry, requestedTags);
  }
  if (mode === "remove") {
    return entryWithTags(entry, currentTags.filter((tag) => !requestedSet.has(tag)));
  }
  return entryWithTags(entry, [...currentTags, ...requestedTags.filter((tag) => !currentTags.includes(tag))]);
}

function deleteEntries(state, records) {
  const nextState = copyListState(state);
  const selectedIds = new Set(records.map(({ entry }) => entry.id));
  listNames(state).forEach((listName) => {
    nextState[listName] = nextState[listName].filter((entry) => !selectedIds.has(entry.id));
  });
  return nextState;
}

function addEntriesToGroup(state, records, action) {
  const groupId = action.groupId ?? action.listId;
  if (typeof groupId !== "string" || !Array.isArray(state?.linkGroups)) {
    return state;
  }

  return {
    ...state,
    linkGroups: state.linkGroups.map((group) => group?.id === groupId
      ? appendEntryIds(group, records)
      : group)
  };
}

function appendEntryIds(group, records) {
  const existingIds = Array.isArray(group.entryIds) ? group.entryIds : [];
  const nextIds = [...existingIds];
  records.forEach(({ entry }) => {
    if (!nextIds.includes(entry.id)) {
      nextIds.push(entry.id);
    }
  });
  return { ...group, entryIds: nextIds };
}

function actionType(action) {
  return action?.type ?? action?.action;
}

function applyAction(state, records, action) {
  switch (actionType(action)) {
    case "pin":
      return moveEntries(state, records, canonicalListName(state, "pinned"));
    case "unpin":
      return moveEntries(state, records, "normal");
    case "move":
      if (!["normal", "pinned", "pins"].includes(action.targetList)) {
        throw new TypeError("Bulk move target must be normal or pinned");
      }
      return moveEntries(state, records, canonicalListName(state, action.targetList));
    case "tag":
      return updateTags(state, records, action);
    case "delete":
      return deleteEntries(state, records);
    case "add-to-list":
      return addEntriesToGroup(state, records, action);
    case "export":
    case "copy":
      return state;
    default:
      throw new TypeError(`Unsupported bulk action: ${String(actionType(action))}`);
  }
}

function canonicalListName(state, requestedListName) {
  if (requestedListName === "normal") {
    return "normal";
  }
  return Array.isArray(state.pinned) ? "pinned" : "pins";
}

function createUndoTransaction(previousState, nextState) {
  const transaction = {
    undo: () => previousState,
    redo: () => nextState
  };
  return Object.freeze(transaction);
}

export function getSelectedEntries(state, selectedIds) {
  return selectedRecords(state, selectedIds).map(({ entry }) => entry);
}

export function buildBulkPreview(state, selectedIds, action = {}) {
  return createBulkPreview(selectedRecords(state, selectedIds), action);
}

function createBulkPreview(records, action) {
  const selectedEntries = records.map(({ entry }) => entry);
  return Object.freeze({
    action: actionType(action),
    count: selectedEntries.length,
    ids: Object.freeze(selectedEntries.map((entry) => entry.id))
  });
}

function createCancelledApplication(state, records, preview) {
  const transaction = createUndoTransaction(state, state);
  return Object.freeze({
    nextState: state,
    state,
    selectedEntries: Object.freeze(records.map(({ entry }) => entry)),
    affectedIds: preview.ids,
    preview,
    transaction,
    undo: transaction.undo,
    redo: transaction.redo,
    cancelled: true
  });
}

function createBulkApplication(state, nextState, records, preview, action) {
  const transaction = createUndoTransaction(state, nextState);
  const selectedEntries = Object.freeze(records.map(({ entry }) => entry));
  const bulkApplication = {
    nextState,
    state: nextState,
    selectedEntries,
    affectedIds: preview.ids,
    preview,
    transaction,
    undo: transaction.undo,
    redo: transaction.redo
  };

  addActionArtifacts(bulkApplication, selectedEntries, action);
  return Object.freeze(bulkApplication);
}

function addActionArtifacts(bulkApplication, selectedEntries, action) {
  if (actionType(action) === "delete") {
    bulkApplication.removedEntries = selectedEntries;
  }
  if (["export", "copy"].includes(actionType(action))) {
    bulkApplication.exportedItems = selectedEntries;
  }
}

function assertBulkState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new TypeError("Bulk actions require a state object");
  }
}

export function applyBulkAction(state, selectedIds, action = {}, options = {}) {
  assertBulkState(state);

  const records = selectedRecords(state, selectedIds);
  const preview = createBulkPreview(records, action);
  if (typeof options.confirm === "function" && options.confirm(preview) === false) {
    return createCancelledApplication(state, records, preview);
  }

  const nextState = applyAction(state, records, action);
  return createBulkApplication(state, nextState, records, preview, action);
}

export function createBulkTransaction(state, selectedIds, action, options) {
  return applyBulkAction(state, selectedIds, action, options);
}

export const BulkActions = Object.freeze({
  apply: applyBulkAction,
  preview: buildBulkPreview
});
