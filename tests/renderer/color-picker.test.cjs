const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "../..");

async function importRendererModule(relativePath) {
  const source = fs.readFileSync(path.join(projectRoot, "src/renderer", relativePath), "utf8");
  const encodedSource = Buffer.from(source).toString("base64");
  return import(`data:text/javascript;base64,${encodedSource}`);
}

test("color picker presentation exposes HEX, RGB, HSL and a bounded recent palette", async () => {
  const { formatColorDetails, addRecentColor } = await importRendererModule("color-picker.js");
  const color = {
    hex: "#112233",
    rgb: { red: 17, green: 34, blue: 51, alpha: 255 },
    hsl: { hue: 210, saturation: 50, lightness: 13 }
  };

  assert.deepEqual(formatColorDetails(color), {
    hex: "#112233",
    rgb: "rgb(17, 34, 51)",
    hsl: "hsl(210 50% 13%)"
  });
  assert.deepEqual(addRecentColor(["#445566", "#112233"], "#112233", 2), ["#112233", "#445566"]);
  assert.deepEqual(addRecentColor([], "#778899", 2), ["#778899"]);
});
