const assert = require("node:assert/strict");
const test = require("node:test");

const { AppHealth } = require("../src/main/release/app-health.cjs");

test("app health returns a redacted operational report without clipboard contents", async () => {
  const health = new AppHealth({
    version: "1.0.0",
    commit: "abc123",
    helperStatus: "fallback-polling",
    storageHealth: {
      async scan() {
        return {
          totalBytes: 12,
          mediaFiles: 1,
          brokenReferences: 0,
          orphanMedia: 0,
          currentGeneration: "gen-3",
          backups: 2,
          lastBackupAt: 100
        };
      }
    },
    timestamps: { lastSaveAt: 90, lastIntegrityAt: 95 }
  });

  const report = await health.collect();
  const serialized = JSON.stringify(report);

  assert.deepEqual(report, {
    appVersion: "1.0.0",
    sourceCommit: "abc123",
    helperStatus: "fallback-polling",
    lastSaveAt: 90,
    lastIntegrityAt: 95,
    storage: {
      totalBytes: 12,
      mediaFiles: 1,
      brokenReferences: 0,
      orphanMedia: 0,
      currentGeneration: "gen-3",
      backups: 2,
      lastBackupAt: 100
    }
  });
  assert.equal(serialized.includes("clipboard"), false);
});
