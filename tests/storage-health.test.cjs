const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { MediaStore } = require("../src/main/storage/media-store.cjs");
const { StorageHealth } = require("../src/main/storage/storage-health.cjs");

const ONE_PIXEL_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360606060000000040001f61738550000000049454e44ae426082", "hex");

test("storage health reports orphan media, broken references, temp drag files, and pending work without plaintext", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-health-"));
  const mediaDirectory = path.join(root, "media");
  const markdownDirectory = path.join(root, "markdown");
  const transactionDirectory = path.join(markdownDirectory, ".transactions");
  const backupDirectory = path.join(root, "backups");
  const dragDirectory = path.join(root, "drag");
  const mediaStore = new MediaStore({ mediaDirectory });
  const kept = mediaStore.write(ONE_PIXEL_PNG, "image/png");
  const orphan = mediaStore.write(Buffer.concat([ONE_PIXEL_PNG, Buffer.from([1])]), "image/png");
  fs.mkdirSync(transactionDirectory, { recursive: true });
  fs.mkdirSync(backupDirectory, { recursive: true });
  fs.mkdirSync(dragDirectory, { recursive: true });
  fs.writeFileSync(path.join(transactionDirectory, "pending.json"), "{}", "utf8");
  fs.writeFileSync(path.join(dragDirectory, "clipboard-shelf-drag.tmp"), "temporary", "utf8");

  try {
    const health = new StorageHealth({ markdownDirectory, mediaDirectory, transactionDirectory, backupDirectory, dragDirectory });
    const report = health.scan({
      pinned: [],
      normal: [
        { type: "image", image: { blobKey: kept.mediaKey, mimeType: kept.mimeType, size: kept.size, hash: kept.sha256 } },
        { type: "image", image: { blobKey: "f".repeat(64), mimeType: "image/png", size: kept.size, hash: "f".repeat(64) } }
      ]
    });

    assert.equal(report.orphanMedia, 1);
    assert.equal(report.brokenReferences, 1);
    assert.equal(report.tempDragFiles, 1);
    assert.equal(report.pendingTransactions, 1);
    assert.doesNotMatch(JSON.stringify(report), /temporary|plaintext|secret/i);
    assert.deepEqual(health.repairReport(), report);
    assert.equal(fs.existsSync(path.join(mediaDirectory, `${orphan.mediaKey}.media`)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("storage health treats a trash image as a live media reference", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-shelf-health-trash-"));
  const mediaDirectory = path.join(root, "media");
  const markdownDirectory = path.join(root, "markdown");
  const transactionDirectory = path.join(markdownDirectory, ".transactions");
  const backupDirectory = path.join(root, "backups");
  const dragDirectory = path.join(root, "drag");
  const mediaStore = new MediaStore({ mediaDirectory });
  const kept = mediaStore.write(ONE_PIXEL_PNG, "image/png");

  try {
    const health = new StorageHealth({ markdownDirectory, mediaDirectory, transactionDirectory, backupDirectory, dragDirectory });
    const report = health.scan({
      pinned: [],
      normal: [],
      trash: [{
        id: "trash-1",
        entry: {
          id: "entry-image-1",
          type: "image",
          image: {
            blobKey: kept.mediaKey,
            mimeType: kept.mimeType,
            size: kept.size,
            hash: kept.sha256
          },
          tags: [],
          createdAt: 1,
          updatedAt: 1
        },
        originalList: "normal",
        deletedAt: 2
      }]
    });

    assert.equal(report.orphanMedia, 0);
    assert.equal(report.brokenReferences, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
