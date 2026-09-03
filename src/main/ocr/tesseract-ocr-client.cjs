class TesseractOcrClient {
  constructor({ recognize } = {}) {
    this.recognizer = recognize || (async (imageBuffer) => {
      const { recognizeOcrText } = require("../../../ocr-engine.cjs");
      return recognizeOcrText(imageBuffer);
    });
  }

  async recognize(imageBuffer, options) {
    const result = await this.recognizer(imageBuffer, options);
    return typeof result === "string"
      ? { text: result, engine: "tesseract", language: "ara+eng" }
      : result;
  }
}

module.exports = { TesseractOcrClient };
