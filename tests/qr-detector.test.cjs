const assert = require("node:assert/strict");
const test = require("node:test");

const { detectCodes } = require("../qr-detector.cjs");

test("reports unsupported when the local dependency set has no bundled code decoder", () => {
  assert.deepEqual(detectCodes(Buffer.from("image")), {
    status: "unsupported",
    qr: [],
    barcodes: [],
    links: []
  });
});

test("reports invalid and protected image inputs without inventing detections", () => {
  assert.deepEqual(detectCodes(Buffer.alloc(0)), {
    status: "invalid",
    qr: [],
    barcodes: [],
    links: []
  });
  assert.deepEqual(detectCodes(Buffer.from("image"), { protected: true }), {
    status: "protected",
    qr: [],
    barcodes: [],
    links: []
  });
});

test("filters unsafe decoder payloads and preserves the source image bytes", () => {
  const imageBytes = Buffer.from("image");
  const result = detectCodes(imageBytes, {
    decoder(decoderBytes) {
      decoderBytes[0] = 0;
      return {
        qr: [
          { payload: " https://example.test/path ", confidence: 0.92 },
          { payload: "javascript:alert(1)", confidence: 0.99 },
          { payload: "\u0000hidden", confidence: 0.8 }
        ],
        barcodes: [{ payload: "012345", confidence: 1.2 }],
        links: ["https://direct.example", "file:///private.txt"]
      };
    }
  });

  assert.deepEqual(result, {
    status: "ok",
    qr: [
      { payload: "https://example.test/path", confidence: 0.92 },
      { payload: "javascript:alert(1)", confidence: 0.99 }
    ],
    barcodes: [{ payload: "012345" }],
    links: ["https://example.test/path", "https://direct.example"]
  });
  assert.equal(imageBytes.toString(), "image");
});

test("drops oversized decoder payloads instead of returning unbounded metadata", () => {
  const result = detectCodes(Buffer.from("image"), {
    decoder() {
      return { qr: [{ payload: "x".repeat(4097) }] };
    }
  });

  assert.deepEqual(result, {
    status: "ok",
    qr: [],
    barcodes: [],
    links: []
  });
});
