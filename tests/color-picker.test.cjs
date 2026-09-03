const assert = require("node:assert/strict");
const test = require("node:test");

const { bgraPixelToHex, bgraPixelToColor, readBgraPixel } = require("../color-picker.cjs");

test("screen pixel conversion returns uppercase HEX from BGRA bytes", () => {
  const bitmap = Buffer.from([0x33, 0x22, 0x11, 0xff]);

  const point = { width: 1, height: 1, x: 0, y: 0 };
  assert.deepEqual(readBgraPixel(bitmap, point), { red: 0x11, green: 0x22, blue: 0x33, alpha: 0xff });
  assert.equal(bgraPixelToHex(bitmap, point), "#112233");
});

test("screen pixel conversion exposes stable RGB and HSL values for the picker UI", () => {
  const bitmap = Buffer.from([0x33, 0x22, 0x11, 0xff]);
  const point = { width: 1, height: 1, x: 0, y: 0 };

  assert.deepEqual(bgraPixelToColor(bitmap, point), {
    hex: "#112233",
    rgb: { red: 0x11, green: 0x22, blue: 0x33, alpha: 0xff },
    hsl: { hue: 210, saturation: 50, lightness: 13 }
  });
});

test("screen pixel conversion rejects points outside the captured image", () => {
  assert.throws(() => readBgraPixel(Buffer.alloc(4), { width: 1, height: 1, x: 1, y: 0 }), /outside/i);
});
