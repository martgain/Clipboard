const path = require("node:path");
const { createWorker } = require("tesseract.js");
const { extractOcrTextFromBlocks, normalizeOcrText, orderOcrLines } = require("./ocr-text.cjs");
const { getOcrRecognitionOptions } = require("./ocr-preprocess.cjs");

let workerPromise = null;

function languageDataDirectory() {
  return path.join(__dirname, "ocr-data");
}

function createLocalWorker() {
  return createWorker("ara+eng", 1, {
    langPath: languageDataDirectory(),
    gzip: true,
    logger: () => {}
  });
}

async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = createLocalWorker();
  }

  try {
    return await workerPromise;
  } catch (workerError) {
    workerPromise = null;
    throw workerError;
  }
}

async function recognizeOcrText(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
    throw new TypeError("OCR image must be a non-empty buffer");
  }

  const worker = await getOcrWorker();
  const recognition = await worker.recognize(
    imageBuffer,
    getOcrRecognitionOptions(),
    { text: true, blocks: true }
  );

  return normalizeRecognition(recognition.data);
}

function normalizeRecognition(recognitionData) {
  const blockText = extractOcrTextFromBlocks(recognitionData.blocks);

  if (blockText) {
    return blockText;
  }

  const orderedLines = orderOcrLines(recognitionData.lines);

  if (orderedLines.length > 0) {
    return normalizeOcrText(orderedLines.map((line) => line.text).join("\n"));
  }

  return normalizeOcrText(recognitionData.text);
}

async function terminateOcrWorker() {
  if (!workerPromise) {
    return;
  }

  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

module.exports = { recognizeOcrText, terminateOcrWorker };
