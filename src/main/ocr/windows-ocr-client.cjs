class WindowsOcrClient {
  constructor({ isAvailable = async () => false, recognize = null } = {}) {
    this.availabilityCheck = isAvailable;
    this.recognizer = recognize;
  }

  async isAvailable(options) {
    return (await this.availabilityCheck(options)) === true;
  }

  async recognize(imageBuffer, options) {
    if (typeof this.recognizer !== "function") {
      const error = new Error("Windows OCR bridge is not configured");
      error.code = "UNAVAILABLE";
      throw error;
    }

    return this.recognizer(imageBuffer, options);
  }
}

module.exports = { WindowsOcrClient };
