const STORAGE_FIELDS = [
  "totalBytes",
  "mediaFiles",
  "brokenReferences",
  "orphanMedia",
  "currentGeneration",
  "backups",
  "lastBackupAt"
];

function safeValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function safeGeneration(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(value) ? value : null;
}

class AppHealth {
  constructor({
    version = "unknown",
    commit = "unknown",
    helperStatus = "unknown",
    storageHealth = null,
    timestamps = {}
  } = {}) {
    this.version = typeof version === "string" ? version.slice(0, 80) : "unknown";
    this.commit = typeof commit === "string" ? commit.slice(0, 80) : "unknown";
    this.helperStatus = typeof helperStatus === "string" ? helperStatus.slice(0, 80) : "unknown";
    this.storageHealth = storageHealth;
    this.timestamps = timestamps;
  }

  async collect() {
    const rawStorage = this.storageHealth && typeof this.storageHealth.scan === "function"
      ? await this.storageHealth.scan()
      : {};
    const storage = Object.fromEntries(STORAGE_FIELDS.map((field) => [
      field,
      field === "currentGeneration" ? safeGeneration(rawStorage?.[field]) : safeValue(rawStorage?.[field])
    ]));

    return {
      appVersion: this.version,
      sourceCommit: this.commit,
      helperStatus: this.helperStatus,
      lastSaveAt: safeValue(this.timestamps.lastSaveAt),
      lastIntegrityAt: safeValue(this.timestamps.lastIntegrityAt),
      storage
    };
  }
}

module.exports = { AppHealth, STORAGE_FIELDS };
