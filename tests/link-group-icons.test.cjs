const assert = require("node:assert/strict");
const test = require("node:test");

const {
  DEFAULT_GROUP_ICON,
  GROUP_ICON_CATALOG,
  getGroupDisplayModel,
  normalizeGroupIcon
} = require("../link-group-icons.js");

test("group icon catalog provides a stable single-icon fallback", () => {
  assert.equal(GROUP_ICON_CATALOG.length >= 10, true);
  assert.equal(new Set(GROUP_ICON_CATALOG.map((icon) => icon.name)).size, GROUP_ICON_CATALOG.length);
  assert.equal(normalizeGroupIcon("not-a-real-icon"), DEFAULT_GROUP_ICON);
  assert.equal(normalizeGroupIcon(GROUP_ICON_CATALOG[3].name), GROUP_ICON_CATALOG[3].name);
});

test("group display model hides the name only in compact mode", () => {
  const group = { name: "شغلي", icon: "briefcase" };

  assert.deepEqual(getGroupDisplayModel(group, false), {
    icon: "briefcase",
    name: "شغلي",
    ariaLabel: "شغلي"
  });
  assert.deepEqual(getGroupDisplayModel(group, true), {
    icon: "briefcase",
    name: "",
    ariaLabel: "شغلي"
  });
});
