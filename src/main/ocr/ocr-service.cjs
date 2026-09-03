const { normalizeOcrText, orderOcrLines } = require("../../../ocr-text.cjs");
const { detectOcrLanguage } = require("../../../ocr-language.cjs");

const LOW_CONFIDENCE_THRESHOLD = 0.65;

function normalizeConfidence(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  const percentageValue = value > 1 ? value / 100 : value;
  return Math.min(1, Math.max(0, percentageValue));
}

function extractText(result) {
  if (typeof result?.text === "string") {
    return result.text;
  }

  const lines = orderOcrLines(result?.lines);
  return lines.map((line) => line.text).join("\n");
}

function normalizeRecognition(result, fallbackEngine) {
  const text = normalizeOcrText(extractText(result));

  if (!text) {
    return null;
  }

  const confidence = normalizeConfidence(result?.confidence);
  return {
    status: "ok",
    text,
    engine: typeof result?.engine === "string" && result.engine ? result.engine : fallbackEngine,
    language: typeof result?.language === "string" && result.language ? result.language : "ara+eng",
    detectedLanguage: detectOcrLanguage(text),
    confidence,
    warnings: confidence < LOW_CONFIDENCE_THRESHOLD ? ["LOW_CONFIDENCE"] : []
  };
}

function protectedSurfaceResult() {
  return {
    status: "protected",
    text: "",
    engine: null,
    language: null,
    confidence: 0,
    warnings: ["PROTECTED_SURFACE"]
  };
}

function defaultTesseractClient() {
  return {
    async recognize(imageBuffer) {
      const { recognizeOcrText } = require("../../../ocr-engine.cjs");
      return {
        text: await recognizeOcrText(imageBuffer),
        engine: "tesseract",
        language: "ara+eng"
      };
    }
  };
}

class OcrService {
  constructor({
    windowsClient = null,
    onnxClient = null,
    tesseractClient = null,
    protectedSurfaceDetector = null
  } = {}) {
    this.windowsClient = windowsClient;
    this.onnxClient = onnxClient;
    this.tesseractClient = tesseractClient || defaultTesseractClient();
    this.protectedSurfaceDetector = typeof protectedSurfaceDetector === "function"
      ? protectedSurfaceDetector
      : () => false;
  }

  async recognize(imageBuffer, options = {}) {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new TypeError("OCR image must be a non-empty buffer");
    }

    if (options.protectedSurface === true || this.protectedSurfaceDetector(imageBuffer, options) === true) {
      return protectedSurfaceResult();
    }

    const clients = [
      ["windows-ocr", this.windowsClient],
      ["onnx-paddleocr", this.onnxClient],
      ["tesseract", this.tesseractClient]
    ].filter(([, client]) => client && typeof client.recognize === "function");
    const failures = [];

    for (const [fallbackEngine, client] of clients) {
      try {
        if (typeof client.isAvailable === "function" && !(await client.isAvailable(options))) {
          continue;
        }

        const normalized = normalizeRecognition(await client.recognize(imageBuffer, options), fallbackEngine);
        if (normalized) {
          return normalized;
        }
      } catch (error) {
        failures.push({ engine: fallbackEngine, code: error?.code || "OCR_FAILED" });
      }
    }

    const unavailableError = new Error("No OCR engine returned readable text");
    unavailableError.code = "OCR_UNAVAILABLE";
    unavailableError.failures = failures;
    throw unavailableError;
  }
}

module.exports = { OcrService, LOW_CONFIDENCE_THRESHOLD, normalizeConfidence };
