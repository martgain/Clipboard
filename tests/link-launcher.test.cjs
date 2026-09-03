const assert = require("node:assert/strict");
const test = require("node:test");

const { prepareLinkGroupUrls } = require("../link-launcher.cjs");

test("link group URLs trim whitespace and preserve their order", () => {
  assert.deepEqual(
    prepareLinkGroupUrls([" https://example.com ", "http://localhost:3000/page"]),
    ["https://example.com", "http://localhost:3000/page"]
  );
});

test("link group URLs reject non-http protocols and malformed values", () => {
  assert.throws(
    () => prepareLinkGroupUrls(["file:///secret.txt"]),
    /HTTP\(S\)/i
  );
  assert.throws(
    () => prepareLinkGroupUrls(["not a url"]),
    /HTTP\(S\)/i
  );
});
