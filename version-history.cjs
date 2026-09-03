function isInvalidGenerationError(error) {
  return error?.code === "ENOENT" || error instanceof SyntaxError || error instanceof TypeError;
}

function freezeSnapshot(snapshot, visited = new WeakSet()) {
  if (!snapshot || typeof snapshot !== "object" || visited.has(snapshot)) {
    return snapshot;
  }

  visited.add(snapshot);
  Object.values(snapshot).forEach((nestedValue) => freezeSnapshot(nestedValue, visited));
  return Object.freeze(snapshot);
}

function cloneSnapshot(state) {
  return structuredClone(state);
}

class VersionHistory {
  constructor(options) {
    const transactionStore = options?.transactionStore ?? options;
    if (!transactionStore
      || typeof transactionStore.generationNames !== "function"
      || typeof transactionStore.readGeneration !== "function"
      || typeof transactionStore.promote !== "function") {
      throw new TypeError("Version history requires a TransactionStore adapter");
    }

    this.transactionStore = transactionStore;
  }

  list() {
    return this.transactionStore.generationNames().flatMap((id) => {
      try {
        const generation = this.transactionStore.readGeneration(id);
        return [{ id: generation.generation, manifestHash: generation.manifestHash }];
      } catch (error) {
        if (!isInvalidGenerationError(error)) {
          throw error;
        }
        return [];
      }
    });
  }

  inspect(id) {
    const generation = this.transactionStore.readGeneration(id);
    const snapshot = {
      id: generation.generation,
      state: cloneSnapshot(generation.state),
      manifestHash: generation.manifestHash
    };
    return freezeSnapshot(snapshot);
  }

  restore(id) {
    const generation = this.transactionStore.readGeneration(id);
    this.transactionStore.promote(generation.generation, generation.manifestHash);
    return { id: generation.generation, manifestHash: generation.manifestHash };
  }
}

module.exports = { VersionHistory };
