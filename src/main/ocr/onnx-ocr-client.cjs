const fs = require("node:fs");
const path = require("node:path");
const { mergeOcrVisualRows, normalizeOcrText, orderOcrLines } = require("../../../ocr-text.cjs");

const MODEL_FILES = {
  det: path.join("det", "ch_PP-OCRv5_det_mobile.onnx"),
  cls: path.join("cls", "ch_PP-LCNet_x0_25_textline_ori_cls_mobile.onnx"),
  rec: path.join("rec", "arabic_PP-OCRv5_rec_mobile.onnx"),
  dict: path.join("dict", "ppocrv5_arabic_dict.txt")
};

const TIME_NUMBER = /^\d{1,2}[:.]\d{2}$/u;
const TIME_MERIDIEM = /^(?:am|pm|ص|م)$/iu;
const COMBINED_TIME = /^(\d{1,2}[:.]\d{2})(am|pm|ص|م)$/iu;
const ARABIC_LETTER = /[\u0621-\u063a\u0641-\u064a\u0671-\u06d3\u06fa-\u06ff]/u;
const BIDI_PROTECTED_RUN = /[\p{P}\p{S}\p{N}]+/gu;
const BIDI_MARKS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;

let bidiFactory = null;

function getBidi() {
  if (!bidiFactory) {
    bidiFactory = require("bidi-js")();
  }

  return bidiFactory;
}

function reorderArabicText(rawOcrLineText) {
  const cleaned = String(rawOcrLineText || "").replace(BIDI_MARKS, "");

  if (!ARABIC_LETTER.test(cleaned)) {
    return normalizeOcrText(cleaned);
  }

  const protectedText = protectBidiRuns(cleaned);
  const bidi = getBidi();
  const levels = bidi.getEmbeddingLevels(protectedText.markedText, "rtl");
  const reorderedText = bidi.getReorderedString(protectedText.markedText, levels);
  return normalizeOcrText(restoreBidiRuns(reorderedText, protectedText.runs));
}

function protectBidiRuns(ocrLineText) {
  const runs = new Map();
  let markerCodePoint = 0xe000;
  const markedText = ocrLineText.replace(BIDI_PROTECTED_RUN, (runText) => {
    const marker = String.fromCodePoint(markerCodePoint);
    markerCodePoint += 1;
    runs.set(marker, runText);
    return marker;
  });

  return { markedText, runs };
}

function restoreBidiRuns(reorderedText, protectedRuns) {
  return [...reorderedText].map((character) => protectedRuns.get(character) || character).join("");
}

function moveTimestampToEnd(normalizedLine) {
  const tokens = normalizeOcrText(normalizedLine).replace(/\n+/gu, " ").split(" ").filter(Boolean);
  const expandedTokens = tokens.flatMap((token) => {
    const match = token.match(COMBINED_TIME);
    return match ? [match[1], match[2]] : [token];
  });
  const numberIndex = expandedTokens.findIndex((token) => TIME_NUMBER.test(token));
  const meridiemIndex = expandedTokens.findIndex((token) => TIME_MERIDIEM.test(token));

  if (numberIndex < 0 || meridiemIndex < 0 || numberIndex === meridiemIndex) {
    return expandedTokens.join(" ");
  }

  const timestamp = [expandedTokens[numberIndex], expandedTokens[meridiemIndex]];
  const remaining = expandedTokens.filter((_, index) => index !== numberIndex && index !== meridiemIndex);
  return [...remaining, ...timestamp].join(" ");
}

function normalizeOnnxLineText(rawText) {
  return moveTimestampToEnd(reorderArabicText(rawText));
}

function isPoint(candidatePoint) {
  return Array.isArray(candidatePoint) && candidatePoint.length >= 2
    && Number.isFinite(Number(candidatePoint[0]))
    && Number.isFinite(Number(candidatePoint[1]));
}

function isBox(candidateBox) {
  return Array.isArray(candidateBox) && candidateBox.length >= 4 && candidateBox.every(isPoint);
}

function isOcrItem(candidateResult) {
  return Array.isArray(candidateResult) && candidateResult.length >= 2 && isBox(candidateResult[0])
    && Array.isArray(candidateResult[1])
    && typeof candidateResult[1][0] === "string";
}

function collectOcrItems(ocrNode, collectedItems = []) {
  if (isOcrItem(ocrNode)) {
    collectedItems.push(ocrNode);
    return collectedItems;
  }

  if (Array.isArray(ocrNode)) {
    ocrNode.forEach((childNode) => collectOcrItems(childNode, collectedItems));
  }

  return collectedItems;
}

function boxToBbox(ocrBox) {
  const xCoordinates = ocrBox.map((point) => Number(point[0]));
  const yCoordinates = ocrBox.map((point) => Number(point[1]));
  return {
    x0: Math.min(...xCoordinates),
    y0: Math.min(...yCoordinates),
    x1: Math.max(...xCoordinates),
    y1: Math.max(...yCoordinates)
  };
}

function buildOnnxLineRecords(rawOcrResult) {
  return collectOcrItems(rawOcrResult).map(([ocrBox, recognition]) => ({
    text: normalizeOnnxLineText(recognition[0]),
    bbox: boxToBbox(ocrBox),
    confidence: Number.isFinite(Number(recognition[1])) ? Number(recognition[1]) : 0
  })).filter((line) => line.text);
}

function averageConfidence(ocrLines) {
  const confidenceValues = ocrLines.map((line) => line.confidence).filter((confidence) => confidence > 0);

  if (confidenceValues.length === 0) {
    return 0;
  }

  return confidenceValues.reduce((total, confidence) => total + confidence, 0) / confidenceValues.length;
}

function buildOcrInitializationOptions(dependencies, modelFiles) {
  return {
    cv: dependencies.cv,
    ort: dependencies.ort,
    cls_image_shape: [3, 80, 160],
    use_space_char: true,
    det_model_array_buffer: modelFiles.det,
    cls_model_array_buffer: modelFiles.cls,
    rec_model_array_buffer: modelFiles.rec,
    rec_char_dict: modelFiles.dict
  };
}

function normalizeOnnxOcrResult(rawOcrResult) {
  const recognizedLines = buildOnnxLineRecords(rawOcrResult);
  const orderedLines = orderOcrLines(recognizedLines);
  const visualLines = mergeOcrVisualRows(
    orderedLines.length === recognizedLines.length ? orderedLines : recognizedLines
  );

  return {
    text: normalizeOcrText(visualLines.map((line) => line.text).join("\n")),
    lines: visualLines,
    confidence: averageConfidence(recognizedLines)
  };
}

function modelDirectory() {
  const candidates = [
    path.join(__dirname, "..", "..", "..", "ocr-models", "ppocrv5"),
    process.resourcesPath && path.join(process.resourcesPath, "app.asar", "ocr-models", "ppocrv5"),
    process.resourcesPath && path.join(process.resourcesPath, "ocr-models", "ppocrv5")
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(path.join(candidate, MODEL_FILES.rec))) || candidates[0];
}

function modelPaths(root = modelDirectory()) {
  return Object.fromEntries(Object.entries(MODEL_FILES).map(([name, relativePath]) => [
    name,
    path.join(root, relativePath)
  ]));
}

class OnnxOcrClient {
  constructor({ modelsRoot = null } = {}) {
    this.modelsRoot = modelsRoot;
    this.initializationPromise = null;
    this.paddleOcr = null;
    this.system = null;
    this.cv = null;
  }

  async isAvailable() {
    const ocrModelPaths = modelPaths(this.modelsRoot || modelDirectory());
    return Object.values(ocrModelPaths).every((modelPath) => fs.existsSync(modelPath));
  }

  async initialize() {
    if (!this.initializationPromise) {
      this.initializationPromise = this.createOcrSystem();
    }

    try {
      return await this.initializationPromise;
    } catch (error) {
      this.initializationPromise = null;
      throw error;
    }
  }

  async loadOcrDependencies() {
    const [{ ONNXPaddleOCR }, cv, ort] = await Promise.all([
      Promise.resolve(require("onnx-ocr-js")),
      Promise.resolve(require("@techstark/opencv-js")),
      Promise.resolve(require("onnxruntime-node"))
    ]);

    return { ONNXPaddleOCR, cv, ort };
  }

  async readOcrModelFiles(ocrModelPaths) {
    const [dict, det, cls, rec] = await Promise.all([
      fs.promises.readFile(ocrModelPaths.dict, "utf8"),
      fs.promises.readFile(ocrModelPaths.det),
      fs.promises.readFile(ocrModelPaths.cls),
      fs.promises.readFile(ocrModelPaths.rec)
    ]);

    return { dict, det, cls, rec };
  }

  async createOcrSystem() {
    const ocrModelPaths = modelPaths(this.modelsRoot || modelDirectory());
    const [dependencies, modelFiles] = await Promise.all([
      this.loadOcrDependencies(),
      this.readOcrModelFiles(ocrModelPaths)
    ]);
    const paddleOcr = new dependencies.ONNXPaddleOCR({ use_angle_cls: true });
    const system = await paddleOcr.init(buildOcrInitializationOptions(dependencies, modelFiles));

    this.paddleOcr = paddleOcr;
    this.system = system;
    this.cv = dependencies.cv;
    return { paddleOcr, system, cv: dependencies.cv };
  }

  async recognize(imageBuffer) {
    if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new TypeError("OCR image must be a non-empty buffer");
    }

    const { paddleOcr, system, cv } = await this.initialize();
    const bgrImage = decodePngToBgr(imageBuffer, cv);

    try {
      const rawOcrResult = await paddleOcr.ocr(system, bgrImage, true, true, true);
      const normalized = normalizeOnnxOcrResult(rawOcrResult);
      return {
        ...normalized,
        engine: "onnx-paddleocr",
        language: "ara+eng"
      };
    } finally {
      bgrImage.delete();
    }
  }
}

function decodePngToBgr(imageBuffer, cv) {
  const { PNG } = require("pngjs");
  const decodedImage = PNG.sync.read(imageBuffer);
  const rgbaImage = cv.matFromArray(
    decodedImage.height,
    decodedImage.width,
    cv.CV_8UC4,
    decodedImage.data
  );
  const bgrImage = new cv.Mat();

  try {
    cv.cvtColor(rgbaImage, bgrImage, cv.COLOR_RGBA2BGR);
    return bgrImage;
  } catch (error) {
    bgrImage.delete();
    throw error;
  } finally {
    rgbaImage.delete();
  }
}

module.exports = {
  OnnxOcrClient,
  modelDirectory,
  modelPaths,
  normalizeOnnxLineText,
  normalizeOnnxOcrResult
};
