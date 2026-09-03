document.addEventListener("click", () => window.colorPickerBridge.pick());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    window.colorPickerBridge.cancel();
  }
});
