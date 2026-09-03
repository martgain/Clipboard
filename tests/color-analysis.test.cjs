const assert = require("node:assert/strict");
const test = require("node:test");
const { PNG } = require("pngjs");

const { analyzeImageColors } = require("../color-analysis.cjs");

function createPng(colors, width, height) {
  const png = new PNG({ width, height });

  colors.forEach((color, index) => {
    const offset = index * 4;
    png.data[offset] = color.red;
    png.data[offset + 1] = color.green;
    png.data[offset + 2] = color.blue;
    png.data[offset + 3] = color.alpha ?? 255;
  });

  return PNG.sync.write(png);
}

test("returns dominant RGB, HEX, HSL, and copy-friendly formats for a flat PNG", () => {
  const imageBytes = createPng([{ red: 17, green: 34, blue: 51 }], 1, 1);
  const originalBytes = Buffer.from(imageBytes);

  assert.deepEqual(analyzeImageColors(imageBytes), {
    dominant: {
      hex: "#112233",
      rgb: { red: 17, green: 34, blue: 51 },
      hsl: { hue: 210, saturation: 50, lightness: 13 }
    },
    palette: [{
      hex: "#112233",
      rgb: { red: 17, green: 34, blue: 51 },
      hsl: { hue: 210, saturation: 50, lightness: 13 }
    }],
    formats: {
      hex: "#112233",
      rgb: "rgb(17, 34, 51)",
      hsl: "hsl(210, 50%, 13%)"
    }
  });
  assert.deepEqual(imageBytes, originalBytes);
});

test("orders the palette by sampled frequency and respects the palette bound", () => {
  const imageBytes = createPng([
    { red: 255, green: 0, blue: 0 },
    { red: 255, green: 0, blue: 0 },
    { red: 255, green: 0, blue: 0 },
    { red: 0, green: 0, blue: 255 }
  ], 4, 1);

  const analysis = analyzeImageColors(imageBytes, { maxSamples: 4, maxPalette: 2 });

  assert.equal(analysis.dominant.hex, "#FF0000");
  assert.deepEqual(analysis.palette.map((color) => color.hex), ["#FF0000", "#0000FF"]);
  assert.equal(analysis.palette.length, 2);
});

test("limits PNG sampling and rejects empty or malformed image bytes", () => {
  const imageBytes = createPng([
    { red: 255, green: 0, blue: 0 },
    { red: 0, green: 0, blue: 255 }
  ], 2, 1);

  assert.equal(analyzeImageColors(imageBytes, { maxSamples: 1 }).palette.length, 1);
  assert.throws(() => analyzeImageColors(Buffer.alloc(0)), /non-empty/i);
  assert.throws(() => analyzeImageColors(Buffer.from("not-png")), /PNG/i);
});
