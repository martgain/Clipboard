function assertPixelPoint(bitmap, point) {
  const { width, height, x, y } = point || {};

  if (!Buffer.isBuffer(bitmap) || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TypeError("Captured screen bitmap dimensions are invalid");
  }

  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
    throw new RangeError("Screen point is outside the captured image");
  }

  if (bitmap.length < width * height * 4) {
    throw new TypeError("Captured screen bitmap is incomplete");
  }
}

function readBgraPixel(bitmap, point) {
  assertPixelPoint(bitmap, point);
  const offset = (point.y * point.width + point.x) * 4;

  return {
    red: bitmap[offset + 2],
    green: bitmap[offset + 1],
    blue: bitmap[offset],
    alpha: bitmap[offset + 3]
  };
}

function toHexChannel(channel) {
  return channel.toString(16).padStart(2, "0");
}

function bgraPixelToHex(bitmap, point) {
  const pixel = readBgraPixel(bitmap, point);
  return `#${toHexChannel(pixel.red)}${toHexChannel(pixel.green)}${toHexChannel(pixel.blue)}`.toUpperCase();
}

function rgbToHsl({ red, green, blue }) {
  const redRatio = red / 255;
  const greenRatio = green / 255;
  const blueRatio = blue / 255;
  const maximum = Math.max(redRatio, greenRatio, blueRatio);
  const minimum = Math.min(redRatio, greenRatio, blueRatio);
  const lightness = (maximum + minimum) / 2;
  const difference = maximum - minimum;
  let hue = 0;
  let saturation = 0;

  if (difference !== 0) {
    saturation = difference / (1 - Math.abs(2 * lightness - 1));

    switch (maximum) {
      case redRatio:
        hue = ((greenRatio - blueRatio) / difference) % 6;
        break;
      case greenRatio:
        hue = (blueRatio - redRatio) / difference + 2;
        break;
      default:
        hue = (redRatio - greenRatio) / difference + 4;
        break;
    }

    hue *= 60;
    if (hue < 0) {
      hue += 360;
    }
  }

  return {
    hue: Math.round(hue),
    saturation: Math.round(saturation * 100),
    lightness: Math.round(lightness * 100)
  };
}

function bgraPixelToColor(bitmap, point) {
  const rgb = readBgraPixel(bitmap, point);

  return {
    hex: bgraPixelToHex(bitmap, point),
    rgb,
    hsl: rgbToHsl(rgb)
  };
}

module.exports = { bgraPixelToHex, bgraPixelToColor, readBgraPixel, rgbToHsl };
