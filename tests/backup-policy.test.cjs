const assert = require("node:assert/strict");
const test = require("node:test");

const { createBackupPlan } = require("../backup-policy.cjs");

test("backup plan keeps the newest backups and applies the retention limit", () => {
  assert.deepEqual(
    createBackupPlan([
      "library-20260830-090000.json",
      "library-20260830-100000.json",
      "library-20260830-110000.json"
    ], 2),
    ["library-20260830-110000.json", "library-20260830-100000.json"]
  );
});

test("backup plan ignores unsafe names and invalid retention values", () => {
  assert.deepEqual(
    createBackupPlan(["../library.json", "library-20260830-110000.json", ""], 0),
    []
  );
});
