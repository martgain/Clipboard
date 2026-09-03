const INTERACTIVE_SELECTOR = "button, input, textarea, select, a, [contenteditable=\"true\"]";

function cardIdentity(card) {
  return {
    entryId: card.dataset.entryId,
    listName: card.dataset.listName
  };
}

function restoreCardFocus(root, identity) {
  const matchingCard = [...root.querySelectorAll(".entry-card")].find((card) => (
    card.dataset.entryId === identity.entryId && card.dataset.listName === identity.listName
  ));
  matchingCard?.focus({ preventScroll: true });
}

function activateFocusedCard(event, root) {
  if (event.key !== " " && event.key !== "Enter") {
    return;
  }

  const target = event.target;
  const card = target?.closest?.(".entry-card");
  if (!card || target.closest(INTERACTIVE_SELECTOR)) {
    return;
  }

  event.preventDefault();
  const identity = cardIdentity(card);
  card.click();
  queueMicrotask(() => restoreCardFocus(root, identity));
}

export class ToolbarController {
  constructor() {
    this.root = null;
    this.classRoot = null;
    this.resizeObserver = null;
  }

  mount(root) {
    this.root = root;
    this.classRoot = root.documentElement || root;
    root.addEventListener("keydown", (event) => activateFocusedCard(event, root));

    if (typeof ResizeObserver === "function") {
      this.resizeObserver = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect?.width;
        if (Number.isFinite(width)) {
          this.setDensity(width);
        }
      });
      this.resizeObserver.observe(root.documentElement || root.body || root);
    }

    const viewportWidth = typeof window !== "undefined" && Number.isFinite(window.innerWidth)
      ? window.innerWidth
      : root.clientWidth;
    this.setDensity(viewportWidth || 355);
  }

  setDensity(width) {
    if (!this.classRoot?.classList || !Number.isFinite(width)) {
      return;
    }

    this.classRoot.classList.toggle("density-compact", width < 270);
    this.classRoot.classList.toggle("density-tight", width < 230);
  }
}
