const { PNG } = require("pngjs");
const { rgbToHsl } = require("./color-picker.cjs");

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const IHDR_CHUNK_TYPE = Buffer.from("IHDR", "ascii");
const DEFAULT_SAMPLE_LIMIT = 10000;
const MAX_SAMPLE_LIMIT = 10000;
const DEFAULT_PALETTE_LIMIT = 5;
const MAX_PALETTE_LIMIT = 12;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_DECODED_PIXELS = 16_777_216;

function analyzeImageColors(imageBytes, options = {}) {
  const pngBytes = toPngBuffer(imageBytes);
  assertPngHeader(pngBytes);
  const limits = normalizeLimits(options);
  const decodedPng = PNG.sync.read(pngBytes);
  const sampledPixels = collectSampledPixels(decodedPng, limits.maxSamples);

  if (sampledPixels.length === 0) {
    throw new RangeError("PNG contains no visible pixels");
  }

  const palette = buildPalette(sampledPixels, limits.maxPalette);
  const dominant = palette[0];
  return { dominant, palette, formats: buildFormats(dominant) };
}

function toPngBuffer(imageBytes) {
  if (!Buffer.isBuffer(imageBytes) && !(imageBytes instanceof Uint8Array)) {
    throw new TypeError("PNG image must be a byte array");
  }
  if (imageBytes.length === 0) {
    throw new TypeError("PNG image must be non-empty");
  }
  return Buffer.from(imageBytes);
}

function assertPngHeader(pngBytes) {
  if (pngBytes.length < 33 || !pngBytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new TypeError("PNG image bytes are invalid");
  }
  if (pngBytes.readUInt32BE(8) !== 13 || !pngBytes.subarray(12, 16).equals(IHDR_CHUNK_TYPE)) {
    throw new TypeError("PNG IHDR chunk is invalid");
  }

  const width = pngBytes.readUInt32BE(16);
  const height = pngBytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION
    || width * height > MAX_DECODED_PIXELS) {
    throw new RangeError("PNG dimensions exceed the analysis limit");
  }
}

function normalizeLimits(options) {
  return {
    maxSamples: boundedLimit(options?.maxSamples, DEFAULT_SAMPLE_LIMIT, MAX_SAMPLE_LIMIT, "sample limit"),
    maxPalette: boundedLimit(options?.maxPalette, DEFAULT_PALETTE_LIMIT, MAX_PALETTE_LIMIT, "palette limit")
  };
}

function boundedLimit(candidate, fallback, maximum, label) {
  if (candidate === undefined) {
    return fallback;
  }
  if (!Number.isInteger(candidate) || candidate < 1) {
    throw new RangeError(`PNG ${label} must be a positive integer`);
  }
  return Math.min(candidate, maximum);
}

function collectSampledPixels(decodedPng, maxSamples) {
  const pixelCount = decodedPng.width * decodedPng.height;
  const step = Math.max(1, Math.ceil(pixelCount / maxSamples));
  const sampledPixels = [];

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += step) {
    const pixel = readRgbaPixel(decodedPng.data, pixelIndex);
    if (pixel.alpha > 0) {
      sampledPixels.push(compositeOnWhite(pixel));
    }
  }
  return sampledPixels;
}

function readRgbaPixel(rgbaBytes, pixelIndex) {
  const offset = pixelIndex * 4;
  return {
    red: rgbaBytes[offset],
    green: rgbaBytes[offset + 1],
    blue: rgbaBytes[offset + 2],
    alpha: rgbaBytes[offset + 3]
  };
}

function compositeOnWhite(pixel) {
  if (pixel.alpha === 255) {
    return { red: pixel.red, green: pixel.green, blue: pixel.blue };
  }

  const opacity = pixel.alpha / 255;
  return {
    red: blendChannel(pixel.red, opacity),
    green: blendChannel(pixel.green, opacity),
    blue: blendChannel(pixel.blue, opacity)
  };
}

function blendChannel(channel, opacity) {
  return Math.round(channel * opacity + 255 * (1 - opacity));
}

function buildPalette(sampledPixels, maxPalette) {
  const colors = new Map();
  sampledPixels.forEach((pixel, sampleIndex) => {
    const colorKey = `${pixel.red},${pixel.green},${pixel.blue}`;
    const current = colors.get(colorKey) || { ...pixel, count: 0, firstIndex: sampleIndex };
    current.count += 1;
    colors.set(colorKey, current);
  });

  return [...colors.values()]
    .sort((firstColor, secondColor) => secondColor.count - firstColor.count
      || firstColor.firstIndex - secondColor.firstIndex)
    .slice(0, maxPalette)
    .map(formatColor);
}

function formatColor(color) {
  const rgb = { red: color.red, green: color.green, blue: color.blue };
  return { hex: rgbToHex(rgb), rgb, hsl: rgbToHsl(rgb) };
}

function rgbToHex({ red, green, blue }) {
  return `#${toHexChannel(red)}${toHexChannel(green)}${toHexChannel(blue)}`.toUpperCase();
}

function toHexChannel(channel) {
  return channel.toString(16).padStart(2, "0");
}

function buildFormats(color) {
  const { red, green, blue } = color.rgb;
  const { hue, saturation, lightness } = color.hsl;
  return {
    hex: color.hex,
    rgb: `rgb(${red}, ${green}, ${blue})`,
    hsl: `hsl(${hue}, ${saturation}%, ${lightness}%)`
  };
}

module.exports = { analyzeImageColors };
