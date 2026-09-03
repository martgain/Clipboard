const assert = require("node:assert/strict");
const test = require("node:test");

const { OcrService } = require("../src/main/ocr/ocr-service.cjs");

test("hybrid OCR prefers Windows OCR and exposes engine, language, and confidence", async () => {
  const calls = [];
  const service = new OcrService({
    windowsClient: {
      async recognize() {
        calls.push("windows");
        return {
          text: "السطر الأول\nSecond line",
          engine: "windows-ocr",
          language: "ar-SA+en-US",
          confidence: 0.94
        };
      }
    },
    tesseractClient: {
      async recognize() {
        calls.push("tesseract");
        return { text: "fallback" };
      }
    }
  });

  const result = await service.recognize(Buffer.from("image"));

  assert.deepEqual(calls, ["windows"]);
  assert.equal(result.status, "ok");
  assert.equal(result.text, "السطر الأول\nSecond line");
  assert.equal(result.engine, "windows-ocr");
  assert.equal(result.detectedLanguage, "mixed");
  assert.equal(result.confidence, 0.94);
  assert.deepEqual(result.warnings, []);
});

test("hybrid OCR uses the local ONNX Arabic client before Tesseract", async () => {
  const calls = [];
  const service = new OcrService({
    onnxClient: {
      async recognize() {
        calls.push("onnx");
        return {
          text: "النص العربي",
          engine: "onnx-paddleocr",
          language: "ara+eng",
          confidence: 0.91
        };
      }
    },
    tesseractClient: {
      async recognize() {
        calls.push("tesseract");
        return { text: "fallback" };
      }
    }
  });

  const result = await service.recognize(Buffer.from("image"));

  assert.deepEqual(calls, ["onnx"]);
  assert.equal(result.engine, "onnx-paddleocr");
  assert.equal(result.text, "النص العربي");
});

test("hybrid OCR falls back when Windows OCR is unavailable and warns on low confidence", async () => {
  const service = new OcrService({
    windowsClient: {
      async recognize() {
        const error = new Error("language pack unavailable");
        error.code = "UNAVAILABLE";
        throw error;
      }
    },
    tesseractClient: {
      async recognize() {
        return {
          lines: [
            { text: "الثاني", bbox: { x0: 5, y0: 100 } },
            { text: "الأول", bbox: { x0: 5, y0: 10 } }
          ],
          engine: "tesseract",
          language: "ara+eng",
          confidence: 0.42
        };
      }
    }
  });

  const result = await service.recognize(Buffer.from("image"));

  assert.equal(result.status, "ok");
  assert.equal(result.text, "الأول\nالثاني");
  assert.equal(result.engine, "tesseract");
  assert.deepEqual(result.warnings, ["LOW_CONFIDENCE"]);
});

test("protected or black surfaces return an honest result without calling OCR engines", async () => {
  let called = false;
  const service = new OcrService({
    protectedSurfaceDetector: () => true,
    tesseractClient: {
      async recognize() {
        called = true;
        return { text: "should not run" };
      }
    }
  });

  const result = await service.recognize(Buffer.from("image"));

  assert.equal(called, false);
  assert.deepEqual(result, {
    status: "protected",
    text: "",
    engine: null,
    language: null,
    confidence: 0,
    warnings: ["PROTECTED_SURFACE"]
  });
});
