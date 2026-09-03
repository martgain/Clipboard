(function initializeGroupIcons(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ClipboardShelfIcons = api;
  }
}(typeof globalThis === "object" ? globalThis : this, function createGroupIconApi() {
  const GROUP_ICON_CATALOG = Object.freeze([
    { name: "link", label: "روابط", definition: [{ name: "path", attributes: { d: "M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" } }, { name: "path", attributes: { d: "M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" } }, { name: "path", attributes: { d: "m8 16 8-8" } }] },
    { name: "folder", label: "مجلد", definition: [{ name: "path", attributes: { d: "M3.5 6.5h6l2 2h9v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" } }] },
    { name: "star", label: "مهم", definition: [{ name: "path", attributes: { d: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" } }] },
    { name: "briefcase", label: "عمل", definition: [{ name: "rect", attributes: { x: "3", y: "7", width: "18", height: "13", rx: "2" } }, { name: "path", attributes: { d: "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2" } }] },
    { name: "code", label: "برمجة", definition: [{ name: "path", attributes: { d: "m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" } }] },
    { name: "globe", label: "مواقع", definition: [{ name: "circle", attributes: { cx: "12", cy: "12", r: "9" } }, { name: "path", attributes: { d: "M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" } }] },
    { name: "home", label: "منزل", definition: [{ name: "path", attributes: { d: "m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6" } }] },
    { name: "heart", label: "مفضلة", definition: [{ name: "path", attributes: { d: "M20.8 8.6c0 5.2-8.8 10.2-8.8 10.2S3.2 13.8 3.2 8.6A4.6 4.6 0 0 1 12 6.3a4.6 4.6 0 0 1 8.8 2.3Z" } }] },
    { name: "bolt", label: "سريع", definition: [{ name: "path", attributes: { d: "m13 2-9 12h7l-1 8 9-12h-7l1-8Z" } }] },
    { name: "book", label: "تعلم", definition: [{ name: "path", attributes: { d: "M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2V5ZM20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2V5Z" } }] },
    { name: "calendar", label: "مواعيد", definition: [{ name: "rect", attributes: { x: "3", y: "5", width: "18", height: "16", rx: "2" } }, { name: "path", attributes: { d: "M16 3v4M8 3v4M3 10h18" } }] },
    { name: "layers", label: "متنوع", definition: [{ name: "path", attributes: { d: "m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" } }] }
  ]);
  const ICONS_BY_NAME = new Map(GROUP_ICON_CATALOG.map((icon) => [icon.name, icon]));
  const DEFAULT_GROUP_ICON = "link";

  function normalizeGroupIcon(iconName) {
    return typeof iconName === "string" && ICONS_BY_NAME.has(iconName)
      ? iconName
      : DEFAULT_GROUP_ICON;
  }

  function getGroupDisplayModel(group, compact) {
    const safeGroup = group && typeof group === "object" ? group : {};
    const name = typeof safeGroup.name === "string" && safeGroup.name.trim()
      ? safeGroup.name.trim()
      : "قائمة روابط";

    return {
      icon: normalizeGroupIcon(safeGroup.icon),
      name: compact ? "" : name,
      ariaLabel: name
    };
  }

  return Object.freeze({
    DEFAULT_GROUP_ICON,
    GROUP_ICON_CATALOG,
    getGroupDisplayModel,
    normalizeGroupIcon
  });
}));
