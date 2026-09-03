const MAX_COLLECTIONS = 100;
const MAX_IDENTIFIER_LENGTH = 128;

function assertCollectionId(id, label = "collection id") {
  if (typeof id !== "string"
    || id.length === 0
    || id.length > MAX_IDENTIFIER_LENGTH
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)
    || id.includes("..")) {
    throw new TypeError(`${label} is invalid`);
  }
}

function cloneCollectionValue(sourceValue, seen = new WeakMap()) {
  if (Array.isArray(sourceValue)) {
    return cloneArray(sourceValue, seen);
  }

  if (!sourceValue || typeof sourceValue !== "object") {
    return sourceValue;
  }

  if (sourceValue instanceof Date) {
    return new Date(sourceValue.getTime());
  }

  return cloneObject(sourceValue, seen);
}

function cloneArray(collectionValues, seen) {
  if (seen.has(collectionValues)) {
    return seen.get(collectionValues);
  }

  const clonedValues = [];
  seen.set(collectionValues, clonedValues);
  collectionValues.forEach((collectionValue) => clonedValues.push(cloneCollectionValue(collectionValue, seen)));
  return clonedValues;
}

function cloneObject(collectionRecord, seen) {
  if (seen.has(collectionRecord)) {
    return seen.get(collectionRecord);
  }

  const clonedRecord = {};
  seen.set(collectionRecord, clonedRecord);
  Object.keys(collectionRecord).forEach((key) => {
    clonedRecord[key] = cloneCollectionValue(collectionRecord[key], seen);
  });
  return clonedRecord;
}

function assertCollectionList(collections) {
  if (!Array.isArray(collections)) {
    throw new TypeError("Collections must be an array");
  }

  if (collections.length > MAX_COLLECTIONS) {
    throw new RangeError(`Collection tree cannot contain more than ${MAX_COLLECTIONS} collections`);
  }
}

function normalizeCollection(collection) {
  if (!collection || typeof collection !== "object" || Array.isArray(collection)) {
    throw new TypeError("Collection record is invalid");
  }

  assertCollectionId(collection.id);
  const parentId = collection.parentId === undefined ? null : collection.parentId;

  if (parentId !== null) {
    assertCollectionId(parentId, "collection parent id");
  }

  const normalized = cloneCollectionValue(collection);
  normalized.parentId = parentId;
  return normalized;
}

function assertNoCycles(collections) {
  const parentById = new Map(collections.map((collection) => [collection.id, collection.parentId]));

  collections.forEach((collection) => assertCollectionAcyclic(collection.id, parentById));
}

function assertCollectionAcyclic(collectionId, parentById) {
  const visited = new Set();
  let currentId = collectionId;

  while (currentId !== null) {
    if (visited.has(currentId)) {
      throw new TypeError("Collection parent cycle detected");
    }
    visited.add(currentId);
    currentId = parentById.get(currentId);
  }
}

function validateCollectionTree(collections) {
  assertCollectionList(collections);
  const normalized = collections.map(normalizeCollection);
  const collectionIds = collectCollectionIds(normalized);
  assertValidParentReferences(normalized, collectionIds);
  assertNoCycles(normalized);
  return normalized;
}

function collectCollectionIds(collections) {
  const collectionIds = new Set();

  collections.forEach((collection) => {
    if (collectionIds.has(collection.id)) {
      throw new TypeError("Duplicate collection id");
    }
    collectionIds.add(collection.id);
  });

  return collectionIds;
}

function assertValidParentReferences(collections, collectionIds) {
  collections.forEach((collection) => {
    if (collection.parentId === collection.id) {
      throw new TypeError("Collection cannot parent itself");
    }

    if (collection.parentId !== null && !collectionIds.has(collection.parentId)) {
      throw new TypeError("Unknown collection parent");
    }
  });
}

function moveCollection(collections, id, parentId = null) {
  const normalized = validateCollectionTree(collections);
  assertCollectionId(id);

  if (parentId !== null) {
    assertCollectionId(parentId, "collection parent id");
  }

  const moved = normalized.find((collection) => collection.id === id);
  if (!moved) {
    throw new TypeError("Collection id was not found");
  }

  if (parentId !== null && !normalized.some((collection) => collection.id === parentId)) {
    throw new TypeError("Unknown collection parent");
  }

  moved.parentId = parentId;
  return validateCollectionTree(normalized);
}

module.exports = {
  moveCollection,
  validateCollectionTree
};
