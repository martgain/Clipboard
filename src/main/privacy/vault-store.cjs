const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SAFE_ID = /^[a-zA-Z0-9._:-]{1,200}$/;
const KEY_LENGTH = 32;

function assertId(id) {
  if (typeof id !== "string" || !SAFE_ID.test(id)) {
    throw new TypeError("Vault id is invalid");
  }
}

function asBuffer(value) {
  return Buffer.isBuffer(value) ? value : Buffer.from(String(value), "utf8");
}

class VaultStore {
  constructor({ directory, safeStorage, now = () => Date.now() } = {}) {
    if (typeof directory !== "string" || !directory) {
      throw new TypeError("Vault directory is required");
    }

    this.directory = path.resolve(directory);
    this.safeStorage = safeStorage;
    this.now = now;
    this.key = null;
    this.records = null;
  }

  async put(item, { id = item?.id, expiresAt = null } = {}) {
    assertId(id);
    if (!item || typeof item !== "object") {
      throw new TypeError("Vault item is required");
    }

    const key = await this.loadKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(item), "utf8"), cipher.final()]);
    const record = {
      id,
      createdAt: this.now(),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : null,
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };

    const records = await this.loadRecords();
    const nextRecords = records.filter((candidate) => candidate.id !== id);
    nextRecords.push(record);
    this.records = nextRecords;
    await this.persistRecords();
    return { id, expiresAt: record.expiresAt };
  }

  async get(id) {
    assertId(id);
    const records = await this.loadRecords();
    const record = records.find((candidate) => candidate.id === id);
    return record ? this.decryptRecord(record) : null;
  }

  async list() {
    const records = await this.loadRecords();
    return records.map((record) => ({ id: record.id, expiresAt: record.expiresAt }));
  }

  async remove(id) {
    assertId(id);
    const records = await this.loadRecords();
    const nextRecords = records.filter((candidate) => candidate.id !== id);
    const removed = nextRecords.length !== records.length;
    if (removed) {
      this.records = nextRecords;
      await this.persistRecords();
    }
    return removed;
  }

  async purge(now = this.now()) {
    if (!Number.isFinite(now)) {
      throw new TypeError("Purge time must be finite");
    }

    const records = await this.loadRecords();
    const nextRecords = records.filter((record) => !Number.isFinite(record.expiresAt) || record.expiresAt > now);
    const removed = records.length - nextRecords.length;
    if (removed > 0) {
      this.records = nextRecords;
      await this.persistRecords();
    }
    return { removed };
  }

  async loadKey() {
    if (this.key) {
      return this.key;
    }

    if (!this.safeStorage || typeof this.safeStorage.isEncryptionAvailable !== "function"
      || this.safeStorage.isEncryptionAvailable() !== true) {
      const error = new Error("OS encryption is unavailable");
      error.code = "VAULT_UNAVAILABLE";
      throw error;
    }

    const keyPath = path.join(this.directory, "wrapped-key.bin");

    try {
      const wrappedKey = await fs.promises.readFile(keyPath, "utf8");
      const encodedKey = this.safeStorage.decryptString(Buffer.from(wrappedKey, "base64"));
      const key = Buffer.from(encodedKey, "base64");
      if (key.length !== KEY_LENGTH) {
        throw new Error("Invalid vault key length");
      }
      this.key = key;
      return key;
    } catch (error) {
      if (error.code === "ENOENT") {
        const key = crypto.randomBytes(KEY_LENGTH);
        const wrapped = asBuffer(this.safeStorage.encryptString(key.toString("base64")));
        await fs.promises.mkdir(this.directory, { recursive: true });
        await fs.promises.writeFile(keyPath, wrapped.toString("base64"), { mode: 0o600 });
        this.key = key;
        return key;
      }

      const decryptError = new Error("Vault key could not be decrypted");
      decryptError.code = "VAULT_DECRYPT_FAILED";
      decryptError.cause = error;
      throw decryptError;
    }
  }

  async loadRecords() {
    if (this.records) {
      return this.records;
    }

    await this.loadKey();
    const recordsPath = path.join(this.directory, "records.json");

    try {
      const parsed = JSON.parse(await fs.promises.readFile(recordsPath, "utf8"));
      this.records = Array.isArray(parsed?.records) ? parsed.records : [];
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      this.records = [];
    }

    return this.records;
  }

  decryptRecord(record) {
    try {
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(record.iv, "base64")
      );
      decipher.setAuthTag(Buffer.from(record.tag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(record.ciphertext, "base64")),
        decipher.final()
      ]).toString("utf8");
      return JSON.parse(plaintext);
    } catch (error) {
      const decryptError = new Error("Vault item could not be decrypted");
      decryptError.code = "VAULT_DECRYPT_FAILED";
      decryptError.cause = error;
      throw decryptError;
    }
  }

  async persistRecords() {
    const recordsPath = path.join(this.directory, "records.json");
    const temporaryPath = `${recordsPath}.tmp-${process.pid}-${this.now()}`;
    await fs.promises.mkdir(this.directory, { recursive: true });
    await fs.promises.writeFile(temporaryPath, JSON.stringify({ version: 1, records: this.records }), {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.promises.rename(temporaryPath, recordsPath);
  }
}

module.exports = { VaultStore, SAFE_ID };
