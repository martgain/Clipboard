const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { TransactionStore } = require("../src/main/storage/transaction-store.cjs");

function makeRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function makeStore(root, options = {}) {
  return new TransactionStore({
    rootDirectory: root,
    serializeState: (state) => JSON.stringify(state),
    deserializeState: (contents) => JSON.parse(contents),
    validateState: (state) => {
      if (!state || typeof state !== "object" || typeof state.value !== "string") {
        throw new TypeError("state is invalid");
      }
    },
    ...options
  });
}

test("TransactionStore commits generations and loads the selected state", async () => {
  const root = makeRoot("clipboard-shelf-transaction-");

  try {
    const store = makeStore(root);
    const committed = await store.commit({ value: "first" });
    const loaded = await store.load();

    assert.match(committed.generation, /^gen-/);
    assert.match(committed.manifestHash, /^[a-f0-9]{64}$/);
    assert.deepEqual(loaded.state, { value: "first" });
    assert.equal(loaded.generation, committed.generation);
    assert.deepEqual(loaded.diagnostics, []);
    assert.equal(fs.existsSync(path.join(root, "current.json")), true);
    assert.equal(fs.existsSync(path.join(root, "pending.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failure after staging leaves the previous generation readable", async () => {
  const root = makeRoot("clipboard-shelf-transaction-crash-");

  try {
    const stableStore = makeStore(root);
    await stableStore.commit({ value: "previous" });
    const failingStore = makeStore(root, {
      failureInjector: (point) => {
        if (point === "after-stage") {
          throw new Error("injected crash");
        }
      }
    });

    await assert.rejects(() => failingStore.commit({ value: "next" }), /injected crash/);
    const loaded = await stableStore.load();

    assert.equal(loaded.state.value, "previous");
    assert.equal(loaded.diagnostics.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a pending journal can roll forward a fully staged generation", async () => {
  const root = makeRoot("clipboard-shelf-transaction-recover-");

  try {
    const stableStore = makeStore(root);
    await stableStore.commit({ value: "previous" });
    const failingStore = makeStore(root, {
      failureInjector: (point) => {
        if (point === "after-journal") {
          throw new Error("interrupted before promotion");
        }
      }
    });

    await assert.rejects(() => failingStore.commit({ value: "next" }), /interrupted/);
    const recovered = await stableStore.recover();
    const loaded = await stableStore.load();

    assert.equal(recovered.recovered, true);
    assert.equal(loaded.state.value, "next");
    assert.equal(fs.existsSync(path.join(root, "pending.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a failure after promotion is safe to replay on restart", async () => {
  const root = makeRoot("clipboard-shelf-transaction-promote-");

  try {
    const stableStore = makeStore(root);
    await stableStore.commit({ value: "previous" });
    const failingStore = makeStore(root, {
      failureInjector: (point) => {
        if (point === "after-promote") {
          throw new Error("crash after promotion");
        }
      }
    });

    await assert.rejects(() => failingStore.commit({ value: "next" }), /promotion/);
    const restartedStore = makeStore(root);
    const recovered = await restartedStore.recover();
    const loaded = await restartedStore.load();

    assert.equal(recovered.recovered, true);
    assert.equal(loaded.state.value, "next");
    assert.equal(fs.existsSync(path.join(root, "pending.json")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a corrupt current generation falls back to the last valid generation", async () => {
  const root = makeRoot("clipboard-shelf-transaction-corrupt-");

  try {
    const store = makeStore(root);
    const first = await store.commit({ value: "first" });
    const second = await store.commit({ value: "second" });
    const manifestPath = path.join(root, "generations", second.generation, "manifest.json");
    fs.writeFileSync(manifestPath, "{\"broken\":true}", "utf8");

    const loaded = await store.load();

    assert.equal(loaded.state.value, "first");
    assert.equal(loaded.generation, first.generation);
    assert.ok(loaded.diagnostics.some((diagnostic) => diagnostic.severity === "warning"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
