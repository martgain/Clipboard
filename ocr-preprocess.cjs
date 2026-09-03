const OCR_MAX_DIMENSION = 4096;
const OCR_SCALE = 2;

function assertImageSize(imageSize) {
  if (!Number.isFinite(imageSize?.width) || !Number.isFinite(imageSize?.height)
    || imageSize.width <= 0 || imageSize.height <= 0) {
    throw new TypeError("OCR image size must be finite and positive");
  }
}

function getOcrResizeSize(imageSize) {
  assertImageSize(imageSize);
  const scale = Math.min(
    OCR_SCALE,
    OCR_MAX_DIMENSION / imageSize.width,
    OCR_MAX_DIMENSION / imageSize.height
  );

  return {
    width: Math.max(1, Math.round(imageSize.width * scale)),
    height: Math.max(1, Math.round(imageSize.height * scale))
  };
}

function getOcrRecognitionOptions() {
  return {
    tessedit_pageseg_mode: "11",
    preserve_interword_spaces: "0",
    user_defined_dpi: "300"
  };
}

module.exports = { getOcrResizeSize, getOcrRecognitionOptions };
