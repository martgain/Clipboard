const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  readClipboardSnapshot,
  snapshotToPayload
} = require("../src/main/clipboard/runtime-clipboard.cjs");

const PNG_BYTES = Buffer.concat([
  Buffer.from("89504e470d0a1a0a", "hex"),
  Buffer.from("runtime-clipboard")
]);

test("runtime clipboard adapter preserves rich metadata while exposing exact text", async () => {
  const snapshot = await readClipboardSnapshot({
    richAdapter: {
      readSnapshot: async (options) => ({
        sequence: options.sequence,
        capturedAt: options.capturedAt,
        sourceApp: options.sourceApp,
        formats: ["text", "html"],
        richFormats: [{ format: "html", size: 12 }],
        payload: { kind: "text", text: "  سطر أول\nسطر ثان  " }
      })
    },
    event: {
      sequence: 17,
      capturedAt: "2026-08-31T10:00:00.000Z",
      sourceApp: { executable: "notepad.exe", pid: 42 },
      formats: ["text", "html"]
    }
  });

  assert.equal(snapshot.signature, "text:  سطر أول\nسطر ثان  ");
  assert.equal(snapshot.payload.text, "  سطر أول\nسطر ثان  ");
  assert.deepEqual(snapshot.sourceApp, { executable: "notepad.exe", pid: 42 });
  assert.deepEqual(snapshot.richFormats, [{ format: "html", size: 12 }]);
  assert.deepEqual(snapshotToPayload(snapshot), {
    kind: "text",
    text: "  سطر أول\nسطر ثان  ",
    sequence: 17,
    capturedAt: "2026-08-31T10:00:00.000Z",
    sourceApp: { executable: "notepad.exe", pid: 42 },
    formats: ["text", "html"],
    richFormats: [{ format: "html", size: 12 }]
  });
});

test("runtime clipboard adapter converts exact image bytes into a data URL", async () => {
  const sha256 = crypto.createHash("sha256").update(PNG_BYTES).digest("hex");
  const snapshot = await readClipboardSnapshot({
    richAdapter: {
      readSnapshot: async () => ({
        formats: ["image"],
        richFormats: [],
        payload: { kind: "image", mimeType: "image/png", bytes: PNG_BYTES, sha256, size: PNG_BYTES.length }
      })
    }
  });

  const payload = snapshotToPayload(snapshot);
  assert.equal(snapshot.signature, `image:${sha256}`);
  assert.equal(payload.dataUrl, `data:image/png;base64,${PNG_BYTES.toString("base64")}`);
  assert.equal(payload.sha256, sha256);
  assert.equal(payload.size, PNG_BYTES.length);
  assert.equal("bytes" in payload, false);
});

test("runtime clipboard adapter falls back only after the rich adapter fails", async () => {
  const fallback = {
    readImage: async () => null,
    readText: async () => "fallback text"
  };

  const snapshot = await readClipboardSnapshot({
    richAdapter: { readSnapshot: async () => { throw new Error("unsupported rich read"); } },
    fallbackAdapter: fallback
  });

  assert.equal(snapshot.payload.text, "fallback text");
  assert.equal(snapshot.signature, "text:fallback text");
});

test("runtime fallback still captures text when image probing is unavailable", async () => {
  const snapshot = await readClipboardSnapshot({
    fallbackAdapter: {
      readImage: async () => { throw new Error("image read unsupported"); },
      readText: async () => "text remains available"
    }
  });

  assert.equal(snapshot.payload.text, "text remains available");
});
