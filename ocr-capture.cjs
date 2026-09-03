function assertPositiveBounds(displayBounds) {
  const fields = ["x", "y", "width", "height"];
  const valid = fields.every((field) => Number.isFinite(displayBounds?.[field]));

  if (!valid || displayBounds.width <= 0 || displayBounds.height <= 0) {
    throw new TypeError("Display bounds must be finite and positive");
  }
}

function assertPoint(point) {
  if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
    throw new TypeError("Selection points must be finite");
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function clampPoint(point, displayBounds) {
  return {
    x: clamp(point.x, displayBounds.x, displayBounds.x + displayBounds.width),
    y: clamp(point.y, displayBounds.y, displayBounds.y + displayBounds.height)
  };
}

function normalizeScreenRect(startPoint, endPoint, displayBounds) {
  assertPositiveBounds(displayBounds);
  assertPoint(startPoint);
  assertPoint(endPoint);

  const start = clampPoint(startPoint, displayBounds);
  const end = clampPoint(endPoint, displayBounds);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x);
  const height = Math.abs(start.y - end.y);

  if (width <= 0 || height <= 0) {
    throw new Error("Selection must have positive area");
  }

  return { x, y, width, height };
}

function assertThumbnailSize(thumbnailSize) {
  if (!Number.isFinite(thumbnailSize?.width) || !Number.isFinite(thumbnailSize?.height)
    || thumbnailSize.width <= 0 || thumbnailSize.height <= 0) {
    throw new TypeError("Thumbnail size must be finite and positive");
  }
}

function scaleRectToThumbnail(screenRect, displayBounds, thumbnailSize) {
  assertPositiveBounds(displayBounds);
  assertThumbnailSize(thumbnailSize);

  const right = screenRect.x + screenRect.width;
  const bottom = screenRect.y + screenRect.height;
  const leftPixel = Math.floor((screenRect.x - displayBounds.x)
    * thumbnailSize.width / displayBounds.width);
  const topPixel = Math.floor((screenRect.y - displayBounds.y)
    * thumbnailSize.height / displayBounds.height);
  const rightPixel = Math.ceil((right - displayBounds.x)
    * thumbnailSize.width / displayBounds.width);
  const bottomPixel = Math.ceil((bottom - displayBounds.y)
    * thumbnailSize.height / displayBounds.height);
  const x = clamp(leftPixel, 0, thumbnailSize.width - 1);
  const y = clamp(topPixel, 0, thumbnailSize.height - 1);
  const endX = clamp(rightPixel, x + 1, thumbnailSize.width);
  const endY = clamp(bottomPixel, y + 1, thumbnailSize.height);

  return { x, y, width: endX - x, height: endY - y };
}

function hasVisiblePixels(bitmap) {
  if (!Buffer.isBuffer(bitmap) || bitmap.length < 4) {
    return false;
  }

  for (let offset = 0; offset + 2 < bitmap.length; offset += 4) {
    if (bitmap[offset] > 8 || bitmap[offset + 1] > 8 || bitmap[offset + 2] > 8) {
      return true;
    }
  }

  return false;
}

module.exports = { normalizeScreenRect, scaleRectToThumbnail, hasVisiblePixels };
