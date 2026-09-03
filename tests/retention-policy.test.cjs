const assert = require("node:assert/strict");
const test = require("node:test");

const { removeExpiredEntries } = require("../retention-policy.cjs");

test("retention policy removes only entries older than the configured age", () => {
  const now = 200_000_000;
  const day = 24 * 60 * 60 * 1000;
  const result = removeExpiredEntries([
    { id: "old", updatedAt: 0 },
    { id: "new", updatedAt: now - day + 1 }
  ], now, 1);

  assert.deepEqual(result.removed.map((entry) => entry.id), ["old"]);
  assert.deepEqual(result.kept.map((entry) => entry.id), ["new"]);
});

test("retention policy keeps everything when disabled", () => {
  const entries = [{ id: "old", updatedAt: 0 }];
  assert.deepEqual(removeExpiredEntries(entries, 10_000_000, 0), { kept: entries, removed: [] });
});
