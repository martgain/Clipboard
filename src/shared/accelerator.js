(function exposeAcceleratorContract(root, factory) {
  const contract = factory();
  if (typeof module === "object" && module.exports) module.exports = contract;
  if (root) root.ClipboardShelfAccelerator = contract;
}(typeof globalThis === "object" ? globalThis : null, () => {
  const modifierLabels = Object.freeze({
    ctrl: "Ctrl", control: "Ctrl", commandorcontrol: "CommandOrControl",
    command: "Command", cmd: "Command", alt: "Alt", option: "Alt", shift: "Shift", super: "Super"
  });
  const modifierOrder = Object.freeze({ Ctrl: 0, CommandOrControl: 0, Command: 0, Alt: 1, Shift: 2, Super: 3 });
  const keyLabels = Object.freeze({
    space: "Space", tab: "Tab", enter: "Enter", escape: "Escape", esc: "Escape", backspace: "Backspace",
    delete: "Delete", insert: "Insert", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown",
    up: "Up", down: "Down", left: "Left", right: "Right"
  });

  function normalizeGlobalShortcut(candidate) {
    if (typeof candidate !== "string" || candidate.length > 80 || /[\r\n]/.test(candidate)) return "";
    const rawParts = candidate.trim().split("+");
    if (rawParts.length < 2 || rawParts.some((part) => !part.trim())) return "";
    const modifiers = [];
    let key = "";
    for (const rawPart of rawParts) {
      const part = rawPart.trim();
      const lowered = part.toLocaleLowerCase();
      const modifier = modifierLabels[lowered];
      if (modifier) {
        if (modifiers.includes(modifier)) return "";
        modifiers.push(modifier);
        continue;
      }
      if (key) return "";
      key = keyLabels[lowered] || (/^[a-z]$/i.test(part) ? part.toLocaleUpperCase() : (/^[0-9]$/.test(part) ? part : (/^f(?:[1-9]|1[0-9]|2[0-4])$/i.test(part) ? part.toLocaleUpperCase() : "")));
      if (!key) return "";
    }
    if (modifiers.length === 0 || !key) return "";
    modifiers.sort((left, right) => modifierOrder[left] - modifierOrder[right]);
    return [...modifiers, key].join("+");
  }

  return Object.freeze({ normalizeGlobalShortcut });
}));
