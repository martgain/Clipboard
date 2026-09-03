const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildRelativeAttachmentPath,
  resolveAttachmentReference
} = require("../attachment-paths.cjs");

test("new attachment references are deterministic relative media paths", () => {
  assert.equal(typeof buildRelativeAttachmentPath, "function");
  assert.equal(typeof resolveAttachmentReference, "function");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-attachments-"));
  const mediaKey = "a".repeat(64);

  try {
    const relativePath = buildRelativeAttachmentPath(mediaKey);
    assert.equal(relativePath, `media/${mediaKey}.media`);
    assert.equal(buildRelativeAttachmentPath(mediaKey, "attachments"), `attachments/${mediaKey}.media`);
    assert.equal(resolveAttachmentReference(root, relativePath), path.join(root, relativePath));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("attachment resolution rejects absolute paths and traversal", () => {
  assert.equal(typeof resolveAttachmentReference, "function");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-attachment-safety-"));

  try {
    ["../outside.media", "media/../../outside.media", "/tmp/outside.media", "C:\\outside.media"].forEach((relativePath) => {
      assert.throws(() => resolveAttachmentReference(root, relativePath), /attachment|path|directory/i);
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
