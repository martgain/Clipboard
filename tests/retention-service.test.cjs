const assert = require("node:assert/strict");
const test = require("node:test");

const { RetentionService } = require("../src/main/privacy/retention-service.cjs");

test("retention expires normal entries only and never removes Pins", () => {
  const service = new RetentionService();
  const state = {
    settings: { retentionDays: 1 },
    pinned: [{ id: "pin", type: "text", text: "keep", updatedAt: 0 }],
    normal: [
      { id: "old", type: "text", text: "remove", updatedAt: 1000 },
      { id: "new", type: "text", text: "keep", updatedAt: 200000000 }
    ],
    linkGroups: []
  };

  const result = service.expire(state, 200000000);

  assert.deepEqual(result.removed.map((entry) => entry.id), ["old"]);
  assert.deepEqual(result.state.pinned.map((entry) => entry.id), ["pin"]);
  assert.deepEqual(result.state.normal.map((entry) => entry.id), ["new"]);
  assert.deepEqual(state.normal.map((entry) => entry.id), ["old", "new"]);
});

test("retention disabled leaves the state unchanged", () => {
  const service = new RetentionService();
  const state = { settings: { retentionDays: 0 }, pinned: [], normal: [{ id: "one" }], linkGroups: [] };
  const result = service.expire(state, Date.now() + 1000000000);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.state, state);
});
