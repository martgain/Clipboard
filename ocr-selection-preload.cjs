const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ocrPickerBridge", Object.freeze({
  select(selection) {
    if (!selection || !selection.start || !selection.end) {
      throw new TypeError("OCR selection points are required");
    }

    ipcRenderer.send("ocr-picker:select", selection);
  },
  cancel() {
    ipcRenderer.send("ocr-picker:cancel");
  }
}));
