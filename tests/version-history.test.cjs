const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { TransactionStore } = require("../src/main/storage/transaction-store.cjs");
const { VersionHistory } = require("../version-history.cjs");

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-history-"));
}

function makeStore(root) {
  return new TransactionStore({
    rootDirectory: root,
    serializeState: (state) => JSON.stringify(state),
    deserializeState: (contents) => JSON.parse(contents),
    validateState: (state) => {
      if (!state || typeof state !== "object" || typeof state.value !== "string") {
        throw new TypeError("state is invalid");
      }
    }
  });
}

test("history lists valid generation metadata without exposing snapshot text", async () => {
  const root = makeRoot();

  try {
    const store = makeStore(root);
    const first = await store.commit({ value: "private first snapshot" });
    const second = await store.commit({ value: "private second snapshot" });
    const history = new VersionHistory({ transactionStore: store });

    const summaries = history.list();

    assert.deepEqual(summaries.map((summary) => summary.id), [second.generation, first.generation]);
    assert.equal(JSON.stringify(summaries).includes("private"), false);
    assert.equal(summaries.every((summary) => typeof summary.manifestHash === "string"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("history inspection is validated, read-only, and rejects corrupt generations", async () => {
  const root = makeRoot();

  try {
    const store = makeStore(root);
    const committed = await store.commit({ value: "inspect me" });
    const history = new VersionHistory({ transactionStore: store });
    const snapshot = history.inspect(committed.generation);

    assert.equal(snapshot.id, committed.generation);
    assert.equal(snapshot.state.value, "inspect me");
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.state), true);
    snapshot.state.value = "changed";
    assert.equal(snapshot.state.value, "inspect me");
    assert.throws(() => history.inspect("gen-0000000000000-deadbeefdead"), /ENOENT|invalid|no valid/i);

    const manifestPath = path.join(root, "generations", committed.generation, "manifest.json");
    fs.writeFileSync(manifestPath, "{\"broken\":true}", "utf8");
    assert.throws(() => history.inspect(committed.generation), /invalid|integrity/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("history restore validates before atomically promoting the requested generation", async () => {
  const root = makeRoot();

  try {
    const store = makeStore(root);
    const first = await store.commit({ value: "first" });
    const second = await store.commit({ value: "second" });
    const history = new VersionHistory({ transactionStore: store });

    const restored = history.restore(first.generation);
    const loaded = await store.load();

    assert.equal(restored.id, first.generation);
    assert.equal(restored.manifestHash, first.manifestHash);
    assert.equal(loaded.generation, first.generation);
    assert.equal(loaded.state.value, "first");
    assert.equal(second.generation === loaded.generation, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
