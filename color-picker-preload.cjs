const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("colorPickerBridge", Object.freeze({
  pick() {
    ipcRenderer.send("color-picker:pick");
  },
  cancel() {
    ipcRenderer.send("color-picker:cancel");
  }
}));
