const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MediaStore } = require("../src/main/storage/media-store.cjs");

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-media-"));
}

test("MediaStore content-addresses validated image bytes", async () => {
  const root = makeRoot();

  try {
    const store = new MediaStore({ mediaDirectory: root });
    const first = await store.write(ONE_PIXEL_PNG, "image/png");
    const second = await store.write(ONE_PIXEL_PNG, "image/png");

    assert.equal(first.mediaKey, first.sha256);
    assert.deepEqual(second, first);
    assert.equal(first.size, ONE_PIXEL_PNG.length);
    assert.deepEqual(await store.read(first.mediaKey), ONE_PIXEL_PNG);
    assert.equal(await store.verify(first.mediaKey, {
      sha256: first.sha256,
      size: first.size,
      mimeType: "image/png"
    }), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MediaStore rejects empty, oversized, and MIME-mismatched bytes", async () => {
  const root = makeRoot();

  try {
    const store = new MediaStore({ mediaDirectory: root, maxBytes: 10 });
    assert.throws(() => store.write(Buffer.alloc(0), "image/png"), /empty/i);
    assert.throws(() => store.write(ONE_PIXEL_PNG, "image/png"), /large|limit/i);

    const normalStore = new MediaStore({ mediaDirectory: root });
    assert.throws(() => normalStore.write(Buffer.from("not-png"), "image/png"), /magic|MIME|match/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MediaStore reports corruption and never removes referenced media", async () => {
  const root = makeRoot();

  try {
    const store = new MediaStore({ mediaDirectory: root });
    const kept = await store.write(ONE_PIXEL_PNG, "image/png");
    const orphan = await store.write(Buffer.concat([ONE_PIXEL_PNG, Buffer.from([1])]), "image/png");
    const orphanPath = path.join(root, orphan.mediaKey + ".media");
    fs.writeFileSync(orphanPath, Buffer.from("corrupted"), "binary");

    assert.equal(await store.verify(orphan.mediaKey), false);
    fs.utimesSync(orphanPath, new Date(0), new Date(0));
    const result = await store.reconcile([kept.mediaKey], { now: Date.now(), graceMs: 0 });

    assert.ok(result.removed.includes(orphan.mediaKey));
    assert.equal(fs.existsSync(path.join(root, kept.mediaKey + ".media")), true);
    assert.equal(fs.existsSync(orphanPath), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
