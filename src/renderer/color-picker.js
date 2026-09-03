const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function normalizeHex(value) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new TypeError("Color HEX must be a six-digit value");
  }

  return value.toUpperCase();
}

export function formatColorDetails(color) {
  const hex = normalizeHex(color?.hex);
  const red = Number(color?.rgb?.red);
  const green = Number(color?.rgb?.green);
  const blue = Number(color?.rgb?.blue);
  const hue = Number(color?.hsl?.hue);
  const saturation = Number(color?.hsl?.saturation);
  const lightness = Number(color?.hsl?.lightness);

  if (![red, green, blue, hue, saturation, lightness].every(Number.isFinite)) {
    throw new TypeError("Color RGB/HSL channels are required");
  }

  return {
    hex,
    rgb: `rgb(${red}, ${green}, ${blue})`,
    hsl: `hsl(${hue} ${saturation}% ${lightness}%)`
  };
}

export function addRecentColor(recentColors, color, limit = 8) {
  const normalizedColor = normalizeHex(color);
  const normalizedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 32)) : 8;
  const source = Array.isArray(recentColors) ? recentColors : [];

  return [
    normalizedColor,
    ...source
      .map((candidate) => {
        try {
          return normalizeHex(candidate);
        } catch {
          return null;
        }
      })
      .filter((candidate) => candidate && candidate !== normalizedColor)
      .slice(0, normalizedLimit - 1)
  ];
}
