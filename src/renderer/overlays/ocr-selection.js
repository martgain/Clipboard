const bridge = window.ocrPickerBridge;
const selectionBox = document.getElementById("selectionBox");
let dragStart = null;

function localPoint(event) {
  return { x: event.clientX, y: event.clientY };
}

function screenPoint(event) {
  return { x: event.screenX, y: event.screenY };
}

function drawSelection(start, end) {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${Math.abs(start.x - end.x)}px`;
  selectionBox.style.height = `${Math.abs(start.y - end.y)}px`;
  selectionBox.style.display = "block";
}

function beginSelection(event) {
  if (event.button !== 0) {
    return;
  }

  dragStart = { local: localPoint(event), screen: screenPoint(event) };
  drawSelection(dragStart.local, dragStart.local);
}

function updateSelection(event) {
  if (dragStart) {
    drawSelection(dragStart.local, localPoint(event));
  }
}

function finishSelection(event) {
  if (!dragStart) {
    return;
  }

  const start = dragStart.screen;
  const end = screenPoint(event);
  dragStart = null;
  bridge.select({ start, end });
}

window.addEventListener("mousedown", beginSelection);
window.addEventListener("mousemove", updateSelection);
window.addEventListener("mouseup", finishSelection);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    bridge.cancel();
  }
});
