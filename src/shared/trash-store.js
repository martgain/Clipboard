(function exposeTrashStore(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }

  root.ClipboardShelfTrash = factory();
}(typeof globalThis === "object" ? globalThis : this, function createTrashStoreModule() {
  "use strict";

  function cloneRecordValue(recordValue, seen = new WeakMap()) {
    if (recordValue === null || typeof recordValue !== "object") {
      return recordValue;
    }
    if (recordValue instanceof Date) {
      return new Date(recordValue.getTime());
    }

    if (seen.has(recordValue)) {
      return seen.get(recordValue);
    }

    const recordClone = Array.isArray(recordValue) ? [] : {};
    seen.set(recordValue, recordClone);
    Object.keys(recordValue).forEach((recordKey) => {
      recordClone[recordKey] = cloneRecordValue(recordValue[recordKey], seen);
    });
    return recordClone;
  }

  function freezeRecord(record) {
    const frozenRecord = {
      ...record,
      entry: cloneRecordValue(record.entry)
    };
    if (record.metadata !== undefined) {
      frozenRecord.metadata = cloneRecordValue(record.metadata);
    }
    return Object.freeze(frozenRecord);
  }

  function validTimestamp(candidateTimestamp) {
    return Number.isFinite(candidateTimestamp) && candidateTimestamp >= 0
      ? candidateTimestamp
      : Date.now();
  }

  function assertRecordId(recordId) {
    if (typeof recordId !== "string" || recordId.trim().length === 0) {
      throw new TypeError("Trash record id is invalid");
    }
  }

  function assertHydratedEntry(entry) {
    if (entry.type === "text") {
      if (typeof entry.text !== "string" || entry.text.trim().length === 0) {
        throw new TypeError("Trash text entry is invalid");
      }
      return;
    }

    if (entry.type !== "image") {
      throw new TypeError("Trash entry type is invalid");
    }

    const image = entry.image;
    if (!image || typeof image !== "object" || Array.isArray(image)
      || typeof image.blobKey !== "string" || image.blobKey.trim().length === 0
      || typeof image.mimeType !== "string" || !/^image\/[a-z0-9.+-]+$/i.test(image.mimeType)
      || !Number.isInteger(image.size) || image.size < 0
      || typeof image.hash !== "string" || image.hash.trim().length === 0) {
      throw new TypeError("Trash image entry is invalid");
    }
  }

  function assertHydratedRecord(record) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new TypeError("Trash record is invalid");
    }
    assertRecordId(record.id);
    if (!record.entry || typeof record.entry !== "object" || Array.isArray(record.entry)) {
      throw new TypeError("Trash record entry is invalid");
    }
    if (typeof record.entry.id !== "string" || record.entry.id.trim().length === 0) {
      throw new TypeError("Trash record entry id is invalid");
    }
    assertHydratedEntry(record.entry);
    if (record.originalList !== "normal" && record.originalList !== "pinned") {
      throw new TypeError("Trash record original list is invalid");
    }
    if (!Number.isFinite(record.deletedAt) || record.deletedAt < 0) {
      throw new TypeError("Trash record deletedAt is invalid");
    }
  }

  function normalizeRemoval(removalRequest, fallbackListName) {
    if (typeof removalRequest === "string" && fallbackListName && typeof fallbackListName === "object") {
      return { entry: fallbackListName, listName: removalRequest, metadata: undefined };
    }
    if (removalRequest && typeof removalRequest === "object" && Object.hasOwn(removalRequest, "entry")) {
      return {
        entry: removalRequest.entry,
        listName: removalRequest.listName ?? removalRequest.originalList ?? fallbackListName,
        metadata: removalRequest.metadata
      };
    }

    return { entry: removalRequest, listName: fallbackListName, metadata: undefined };
  }

  function createTrashRecord(removal, deletedAt, idFactory, existingRecords) {
    let recordId = String(idFactory(removal.entry, deletedAt));
    if (!recordId || recordId === "undefined" || recordId === "null") {
      recordId = `trash-${deletedAt}`;
    }
    while (existingRecords.has(recordId)) {
      recordId = `${recordId}-${existingRecords.size + 1}`;
    }

    const trashRecord = {
      id: recordId,
      entry: cloneRecordValue(removal.entry),
      originalList: normalizeOriginalList(removal.listName),
      deletedAt
    };
    if (removal.metadata !== undefined) {
      trashRecord.metadata = cloneRecordValue(removal.metadata);
    }
    return trashRecord;
  }

  function normalizeOriginalList(candidateListName) {
    const normalizedListName = typeof candidateListName === "string" ? candidateListName.trim() : "";
    if (!normalizedListName) {
      return "normal";
    }
    if (normalizedListName !== "normal" && normalizedListName !== "pinned") {
      throw new TypeError("Trash record original list is invalid");
    }
    return normalizedListName;
  }

  class TrashStore {
    constructor(options = {}) {
      this.now = typeof options.now === "function" ? options.now : () => Date.now();
      this.idFactory = typeof options.idFactory === "function"
        ? options.idFactory
        : () => `trash-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      this.records = new Map();
      if (options.records !== undefined) {
        this.hydrate(options.records);
      }
    }

    remove(input, listName = "normal") {
      const removal = normalizeRemoval(input, listName);
      if (!removal.entry || typeof removal.entry !== "object" || Array.isArray(removal.entry)) {
        throw new TypeError("Trash entries must be objects");
      }

      const deletedAt = validTimestamp(this.now());
      const trashRecord = createTrashRecord(removal, deletedAt, this.idFactory, this.records);
      this.records.set(trashRecord.id, trashRecord);
      return freezeRecord(trashRecord);
    }

    hydrate(records) {
      if (!Array.isArray(records)) {
        throw new TypeError("Trash records must be an array");
      }

      const nextRecords = new Map();
      records.forEach((record) => {
        assertHydratedRecord(record);
        if (nextRecords.has(record.id)) {
          throw new TypeError("Duplicate trash record id");
        }
        nextRecords.set(record.id, cloneRecordValue(record));
      });

      this.records = nextRecords;
      return this;
    }

    toRecords() {
      return this.list().map((record) => cloneRecordValue(record));
    }

    get(recordId) {
      const trashRecord = this.records.get(recordId);
      return trashRecord ? freezeRecord(trashRecord) : null;
    }

    list() {
      return [...this.records.values()]
        .sort((leftRecord, rightRecord) => rightRecord.deletedAt - leftRecord.deletedAt)
        .map(freezeRecord);
    }

    restore(recordId) {
      const trashRecord = this.records.get(recordId);
      if (!trashRecord) {
        return null;
      }

      this.records.delete(recordId);
      const restoredEntry = cloneRecordValue(trashRecord.entry);
      return Object.freeze({
        id: restoredEntry.id,
        entry: restoredEntry,
        listName: trashRecord.originalList,
        recordId: trashRecord.id
      });
    }

    purge(selector) {
      if (selector === undefined || selector === null) {
        const purgedCount = this.records.size;
        this.records.clear();
        return purgedCount;
      }

      return this.deleteRecordIds(this.selectPurgeIds(selector));
    }

    selectPurgeIds(selector) {
      const purgeIds = new Set();
      if (typeof selector === "string") {
        purgeIds.add(selector);
      } else if (Array.isArray(selector)) {
        selector.forEach((recordId) => purgeIds.add(recordId));
      } else if (selector && typeof selector === "object") {
        if (selector.id !== undefined) {
          purgeIds.add(selector.id);
        }
        this.addExpiredRecordIds(purgeIds, selector.before ?? selector.olderThan);
      }
      return purgeIds;
    }

    addExpiredRecordIds(purgeIds, beforeTimestamp) {
      if (!Number.isFinite(beforeTimestamp)) {
        return;
      }
      this.records.forEach((trashRecord) => {
        if (trashRecord.deletedAt < beforeTimestamp) {
          purgeIds.add(trashRecord.id);
        }
      });
    }

    deleteRecordIds(recordIds) {
      let purgedCount = 0;
      recordIds.forEach((recordId) => {
        if (this.records.delete(recordId)) {
          purgedCount += 1;
        }
      });
      return purgedCount;
    }
  }

  function createTrashStore(options) {
    return new TrashStore(options);
  }

  return Object.freeze({
    TrashStore,
    createTrashStore
  });
}));
