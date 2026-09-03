const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { VaultStore } = require("../src/main/privacy/vault-store.cjs");

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      return Buffer.from(value, "utf8").toString("base64");
    },
    decryptString(value) {
      return Buffer.from(String(value), "base64").toString("utf8");
    }
  };
}

test("vault encrypts sensitive items outside Markdown and supports get/list", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-vault-"));
  const store = new VaultStore({ directory: root, safeStorage: fakeSafeStorage() });

  try {
    await store.put({ id: "secret-1", text: "رسالة خاصة لا تظهر في Markdown" }, { expiresAt: 2000 });
    assert.deepEqual(await store.get("secret-1"), { id: "secret-1", text: "رسالة خاصة لا تظهر في Markdown" });
    assert.deepEqual(await store.list(), [{ id: "secret-1", expiresAt: 2000 }]);

    const files = fs.readdirSync(root).flatMap((name) => {
      const filePath = path.join(root, name);
      return fs.statSync(filePath).isFile() ? [fs.readFileSync(filePath, "utf8")] : [];
    });
    assert.equal(files.join("\n").includes("رسالة خاصة"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("vault reports decrypt failures without returning plaintext", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-vault-"));
  const store = new VaultStore({ directory: root, safeStorage: fakeSafeStorage() });

  try {
    await store.put({ id: "secret-1", text: "private" });
    const brokenStorage = {
      ...fakeSafeStorage(),
      decryptString() {
        throw new Error("DPAPI failure");
      }
    };
    const brokenStore = new VaultStore({ directory: root, safeStorage: brokenStorage });
    await assert.rejects(() => brokenStore.get("secret-1"), (error) => error.code === "VAULT_DECRYPT_FAILED");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
