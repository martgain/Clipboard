class WindowController {
  constructor({ BrowserWindow, preloadPath, rendererPath, localRendererUrl, preferences, onCreated, onReady, onResize, onMove, onClosed }) {
    this.BrowserWindow = BrowserWindow;
    this.preloadPath = preloadPath;
    this.rendererPath = rendererPath;
    this.localRendererUrl = localRendererUrl;
    this.preferences = preferences;
    this.onCreated = onCreated;
    this.onReady = onReady;
    this.onResize = onResize;
    this.onMove = onMove;
    this.onClosed = onClosed;
  }

  async createMain() {
    const window = new this.BrowserWindow({
      width: this.preferences.width, height: this.preferences.height, minWidth: 210, minHeight: 260,
      x: this.preferences.x, y: this.preferences.y, frame: false, resizable: true,
      alwaysOnTop: this.preferences.alwaysOnTop, show: true, backgroundColor: "#f4f1ea", title: "رف الحافظة",
      webPreferences: { preload: this.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
    });
    this.onCreated?.(window);
    window.setContentSize(this.preferences.width, this.preferences.height);
    window.setMenuBarVisibility(false);
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, url) => {
      if (url !== this.localRendererUrl) event.preventDefault();
    });
    window.webContents.once("did-finish-load", this.onReady);
    window.on("resize", this.onResize);
    window.on("move", this.onMove);
    window.on("closed", this.onClosed);
    await window.loadFile(this.rendererPath);
    return window;
  }
}

module.exports = { WindowController };
