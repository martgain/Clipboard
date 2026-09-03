export class AccessibilityAnnouncer {
  constructor(liveRegion) {
    this.liveRegion = liveRegion;
  }

  announce(message) {
    this.liveRegion.textContent = "";
    queueMicrotask(() => {
      this.liveRegion.textContent = message;
    });
  }
}
