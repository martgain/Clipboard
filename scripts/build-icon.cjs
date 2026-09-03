const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow } = require("electron");

const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
const projectRoot = path.resolve(__dirname, "..");
const svgPath = path.join(projectRoot, "assets", "clipboard-shelf.svg");
const pngPath = path.join(projectRoot, "assets", "clipboard-shelf.png");
const icoPath = path.join(projectRoot, "assets", "clipboard-shelf.ico");

function svgDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function icoEntry(size, png, offset) {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0);
  entry.writeUInt8(size === 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(offset, 12);
  return entry;
}

function buildIco(pngBySize) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngBySize.length, 4);
  const directoryEnd = 6 + (pngBySize.length * 16);
  let offset = directoryEnd;
  const entries = pngBySize.map(({ size, png }) => {
    const entry = icoEntry(size, png, offset);
    offset += png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngBySize.map(({ png }) => png)]);
}

async function renderIconSource(svg) {
  const previewWindow = new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    width: 256,
    height: 256,
    useContentSize: true
  });
  try {
    await previewWindow.loadURL(svgDataUrl(svg));
    return previewWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: 256,
      height: 256
    });
  } finally {
    previewWindow.destroy();
  }
}

async function renderIcons() {
  const svg = fs.readFileSync(svgPath, "utf8");
  const source = await renderIconSource(svg);
  if (source.isEmpty()) {
    throw new Error("The SVG icon rendered as an empty native image");
  }
  const pngBySize = ICON_SIZES.map((size) => ({
    size,
    png: source.resize({ width: size, height: size, quality: "best" }).toPNG()
  }));
  fs.writeFileSync(pngPath, pngBySize.at(-1).png);
  fs.writeFileSync(icoPath, buildIco(pngBySize));
  console.log(`Icon written: ${icoPath}`);
}

app.whenReady().then(renderIcons).then(() => app.quit()).catch((error) => {
  console.error(error);
  app.exit(1);
});
