class ClipboardAdapter {
  constructor({ clipboard, ClipboardItem, Blob }) {
    this.clipboard = clipboard;
    this.ClipboardItem = ClipboardItem;
    this.Blob = Blob;
  }

  readText() {
    return this.clipboard.readText();
  }

  async readImage() {
    const items = await this.clipboard.read();
    const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
    if (!imageItem) return null;
    const mimeType = imageItem.types.find((type) => type.startsWith("image/"));
    const imageBlob = await imageItem.getType(mimeType);
    return { mimeType, bytes: Buffer.from(await imageBlob.arrayBuffer()) };
  }

  writeText(text) {
    return this.clipboard.writeText(text);
  }

  async writeImage(dataUrl) {
    const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(dataUrl);
    if (!match) throw new TypeError("Clipboard image must be a base64 image data URL");

    const blob = new this.Blob([Buffer.from(match[2], "base64")], { type: match[1] });
    await this.clipboard.write([new this.ClipboardItem({ [match[1]]: blob })]);
  }
}

module.exports = { ClipboardAdapter };
