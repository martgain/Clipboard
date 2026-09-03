const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const rendererModuleFiles = [
  "src/renderer/app-state.js",
  "src/renderer/render-library.js",
  "src/renderer/toolbar.js",
  "src/renderer/settings.js",
  "src/renderer/accessibility.js",
  "src/renderer/color-picker.js",
  "src/renderer/save-queue.js",
  "src/renderer/collections.js",
  "src/renderer/quick-palette.js",
  "src/renderer/bulk-actions.js",
  "src/renderer/inspector.js",
  "src/renderer/app.js"
];
const rendererStyleFiles = [
  "src/renderer/styles/tokens.css",
  "src/renderer/styles/components.css"
];
const overlayAssetFiles = [
  "src/renderer/overlays/color-picker.css",
  "src/renderer/overlays/color-picker.js",
  "src/renderer/overlays/ocr-selection.css",
  "src/renderer/overlays/ocr-selection.js"
];
const mainBackendFiles = [
  "src/main/clipboard-adapter.cjs",
  "src/main/ipc/register-ipc.cjs",
  "src/main/storage/media-store.cjs",
  "src/main/storage/transaction-store.cjs",
  "src/main/storage/backup-store.cjs",
  "src/main/storage/markdown-watcher.cjs",
  "src/main/storage/storage-health.cjs",
  "src/main/storage/replace-safe.cjs",
  "src/main/transform-service.cjs",
  "src/main/clipboard/clipboard-service.cjs",
  "src/main/clipboard/electron-clipboard-adapter.cjs",
  "src/main/clipboard/runtime-clipboard.cjs",
  "src/main/clipboard/windows-listener-client.cjs",
  "src/main/keyboard-lock-client.cjs",
  "src/main/ocr/ocr-service.cjs",
  "src/main/ocr/windows-ocr-client.cjs",
  "src/main/ocr/tesseract-ocr-client.cjs",
  "src/main/ocr/subtitle-session.cjs",
  "src/main/ocr/ocr-index.cjs",
  "src/main/privacy/vault-store.cjs",
  "src/main/privacy/retention-service.cjs",
  "src/main/release/app-health.cjs",
  "src/main/window-controller.cjs",
  "src/shared/validation.cjs",
  "src/shared/accelerator.js",
  "src/shared/contracts.cjs"
];
const requiredFiles = [
  "package.json",
  "main.cjs",
  "preload.cjs",
  "clipboard-shelf.html",
  "clipboard-batch.cjs",
  "paste-sequence.cjs",
  "collection-tree.cjs",
  "version-history.cjs",
  "background-index-queue.cjs",
  "ocr-language.cjs",
  "qr-detector.cjs",
  "color-analysis.cjs",
  "text-transforms.cjs",
  "selection-model.cjs",
  "library-store.cjs",
  "markdown-library.cjs",
  "entry-metadata.cjs",
  "markdown-frontmatter.cjs",
  "attachment-paths.cjs",
  "link-group-icons.js",
  "backup-policy.cjs",
  "library-filter.cjs",
  "retention-policy.cjs",
  "link-launcher.cjs",
  "image-drag.cjs",
  "color-picker.cjs",
  "color-picker-overlay.html",
  "color-picker-preload.cjs",
  "ocr-capture.cjs",
  "ocr-text.cjs",
  "ocr-preprocess.cjs",
  "ocr-engine.cjs",
  "ocr-selection-overlay.html",
  "ocr-selection-preload.cjs",
  "ocr-data/ara.traineddata.gz",
  "ocr-data/eng.traineddata.gz",
  ...rendererModuleFiles,
  ...rendererStyleFiles,
  ...overlayAssetFiles,
  ...mainBackendFiles
];
const missingFiles = requiredFiles.filter((fileName) => !fs.existsSync(path.join(projectRoot, fileName)));

if (missingFiles.length > 0) {
  console.error(`Missing required app files: ${missingFiles.join(", ")}`);
  process.exitCode = 1;
} else {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const requiredScripts = ["start", "check", "test", "manifest", "verify:asar", "build:portable", "build:installer"];
  const missingScripts = requiredScripts.filter((scriptName) => typeof packageJson.scripts?.[scriptName] !== "string");

  if (missingScripts.length > 0) {
    throw new Error(`Missing package scripts: ${missingScripts.join(", ")}`);
  }

  for (const fileName of ["main.cjs", "preload.cjs", "clipboard-batch.cjs", "paste-sequence.cjs", "collection-tree.cjs", "version-history.cjs", "background-index-queue.cjs", "ocr-language.cjs", "qr-detector.cjs", "color-analysis.cjs", "text-transforms.cjs", "selection-model.cjs", "library-store.cjs", "markdown-library.cjs", "entry-metadata.cjs", "markdown-frontmatter.cjs", "attachment-paths.cjs", "link-group-icons.js", "backup-policy.cjs", "library-filter.cjs", "retention-policy.cjs", "link-launcher.cjs", "image-drag.cjs", "color-picker.cjs", "color-picker-preload.cjs", "ocr-capture.cjs", "ocr-text.cjs", "ocr-preprocess.cjs", "ocr-engine.cjs", "ocr-selection-preload.cjs", ...mainBackendFiles]) {
    const filePath = path.join(projectRoot, fileName);
    new vm.Script(fs.readFileSync(filePath, "utf8"), { filename: filePath });
  }

  const htmlPath = path.join(projectRoot, "clipboard-shelf.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const rendererPath = path.join(projectRoot, "src/renderer/app.js");
  const rendererSource = fs.readFileSync(rendererPath, "utf8");
  const rendererCss = rendererStyleFiles
    .map((fileName) => fs.readFileSync(path.join(projectRoot, fileName), "utf8"))
    .join("\n");
  const rendererContractSource = `${html}\n${rendererSource}\n${rendererCss}`;

  function assertModuleSyntax(fileName) {
    const filePath = path.join(projectRoot, fileName);
    const moduleSource = fs.readFileSync(filePath, "utf8")
      .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
      .replace(/\bexport\s+(?=(?:class|function|const|let|var)\b)/g, "");
    new vm.Script(moduleSource, { filename: filePath });
  }

  rendererModuleFiles.forEach(assertModuleSyntax);
  ["src/renderer/overlays/color-picker.js", "src/renderer/overlays/ocr-selection.js"]
    .forEach((fileName) => {
      const filePath = path.join(projectRoot, fileName);
      new vm.Script(fs.readFileSync(filePath, "utf8"), { filename: filePath });
    });

  function assertStrictLocalHtml(fileName, assetPaths) {
    const documentSource = fs.readFileSync(path.join(projectRoot, fileName), "utf8");
    const csp = documentSource.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*>/i)?.[0] || "";
    const requiredCsp = [
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'none'",
      "object-src 'none'",
      "base-uri 'none'"
    ];

    if (requiredCsp.some((directive) => !csp.includes(directive)) || /unsafe-inline|https?:|wss?:/.test(csp)) {
      throw new Error(`${fileName} must use a strict local-only CSP`);
    }
    if (/<style\b/i.test(documentSource) || /<script(?![^>]*\bsrc=)[^>]*>/i.test(documentSource)) {
      throw new Error(`${fileName} must not contain inline style or script blocks`);
    }
    if (/\son[a-z]+\s*=/i.test(documentSource)) {
      throw new Error(`${fileName} must not contain inline event handlers`);
    }

    const missingAssets = assetPaths.filter((assetPath) => !documentSource.includes(assetPath));
    if (missingAssets.length > 0) {
      throw new Error(`${fileName} is missing local assets: ${missingAssets.join(", ")}`);
    }
  }

  assertStrictLocalHtml("clipboard-shelf.html", [
    "./link-group-icons.js",
    "./src/renderer/styles/tokens.css",
    "./src/renderer/styles/components.css",
    "./src/renderer/app.js"
  ]);
  assertStrictLocalHtml("color-picker-overlay.html", [
    "./src/renderer/overlays/color-picker.css",
    "./src/renderer/overlays/color-picker.js"
  ]);
  assertStrictLocalHtml("ocr-selection-overlay.html", [
    "./src/renderer/overlays/ocr-selection.css",
    "./src/renderer/overlays/ocr-selection.js"
  ]);

  if (/\bconst desktopBridge\s*=/.test(rendererSource)) {
    throw new Error("Renderer must not declare a top-level desktopBridge binding; Electron exposes that name globally");
  }

  if (!/\bconst desktopApi\s*=\s*window\.desktopBridge\b/.test(rendererSource)) {
    throw new Error("Renderer must use desktopApi for its local Electron bridge reference");
  }

  if (!rendererSource.includes('event.code === "KeyV"') || !rendererSource.includes('event.code === "KeyC"')) {
    throw new Error("Renderer shortcuts must recognize physical V/C keys across keyboard layouts");
  }

  const packagedFiles = new Set(packageJson.build?.files || []);
  const missingPackagedAssets = ["entry-metadata.cjs", "markdown-frontmatter.cjs", "attachment-paths.cjs", ...rendererModuleFiles, ...rendererStyleFiles, ...overlayAssetFiles, ...mainBackendFiles]
    .filter((fileName) => !packagedFiles.has(fileName));
  if (missingPackagedAssets.length > 0) {
    throw new Error(`Renderer assets missing from electron-builder files: ${missingPackagedAssets.join(", ")}`);
  }

  const bridgeMethods = [
    "loadLibrary",
    "saveLibrary",
    "writeLibraryImage",
    "readLibraryImage",
    "deleteLibraryImage",
    "startImageDrag",
    "startColorPicker",
    "onColorPicked",
    "startOcrPicker",
    "onOcrResult",
    "openLinkGroup",
    "readClipboard",
    "writeText",
    "writeImage",
    "minimizeWindow",
    "closeWindow",
    "toggleWindowVisibility",
  "setGlobalShortcutEnabled",
    "setAlwaysOnTop",
    "getAlwaysOnTop",
    "createLibrarySnapshot",
    "listLibrarySnapshots",
    "verifyLibrarySnapshot",
    "restoreLibrarySnapshot",
    "getLibraryHealth",
    "getAppHealth",
    "openMarkdownDirectory",
    "onLibraryConflict"
  ];
  const preloadSource = fs.readFileSync(path.join(projectRoot, "preload.cjs"), "utf8");
  const missingBridgeMethods = bridgeMethods.filter((methodName) => !preloadSource.includes(methodName));

  if (missingBridgeMethods.length > 0) {
    throw new Error(`Missing desktop bridge methods: ${missingBridgeMethods.join(", ")}`);
  }

  if (!preloadSource.includes("onClipboardChanged")) {
    throw new Error("Desktop bridge must expose automatic clipboard change notifications");
  }

  const mainSource = fs.readFileSync(path.join(projectRoot, "main.cjs"), "utf8");
  if (!/function restoreWindowDimension\(candidate, fallback, minimum\)\s*\{\s*return Number\.isInteger\(candidate\) && candidate >= minimum \? candidate : fallback;\s*\}/s.test(mainSource)) {
    throw new Error("Window dimension validation must return a valid resizable dimension, not a boolean");
  }
  if (!mainSource.includes("rawPreferences.version !== PREFERENCES_VERSION") || !mainSource.includes("version: PREFERENCES_VERSION")) {
    throw new Error("Window preferences must migrate legacy dimensions before restoring them");
  }
  if (!mainSource.includes("const PREFERENCES_VERSION = 4")) {
    throw new Error("Window preference version must include the stable content-size migration");
  }
  if (!mainSource.includes("mainWindow.setContentSize(windowPreferences.width, windowPreferences.height)")) {
    throw new Error("Window content size must be applied explicitly after restoring preferences");
  }
  if (!mainSource.includes("width: Math.max(MIN_WINDOW_WIDTH, bounds.width - 1)") || !mainSource.includes("height: Math.max(MIN_WINDOW_HEIGHT, bounds.height - 1)")) {
    throw new Error("Window preferences must normalize Electron bounds before saving");
  }

  const ipcRegistrationSource = fs.readFileSync(path.join(projectRoot, "src", "main", "ipc", "register-ipc.cjs"), "utf8");
  const sharedContractsSource = fs.readFileSync(path.join(projectRoot, "src", "shared", "contracts.cjs"), "utf8");
  const extractedIpcRegistration = mainSource.includes("registerIpc({") && ipcRegistrationSource.includes("ipcMain.handle(channel");
  const backendContractSource = [mainSource, ipcRegistrationSource, sharedContractsSource].join("\n");
  const requiredBackendContracts = extractedIpcRegistration ? [
    "registerIpc({",
    "ipcMain.handle(channel",
    "ipcMain.on(CHANNELS.dragImage",
    "const CHANNELS = Object.freeze",
    "createImageDragFile",
    "recognizeOcrText",
    "scaleRectToThumbnail",
    "hasVisiblePixels",
    "getOcrResizeSize",
    "desktopCapturer",
    "function openLinkGroup(links)",
    "--new-window",
    "ClipboardAdapter",
    "clipboardAdapter"
  ] : [
    'ipcMain.handle("library:load"',
    'ipcMain.handle("library:save"',
    'ipcMain.handle("library:list-backups"',
    'ipcMain.handle("library:restore-backup"',
    'ipcMain.handle("library:cleanup-media"',
    'ipcMain.handle("window:toggle-visibility"',
    'ipcMain.handle("window:set-global-shortcut"',
    'ipcMain.handle("links:open-group"',
    'ipcMain.on("drag:image"',
    "createImageDragFile",
    'ipcMain.handle("color-picker:start"',
    'ipcMain.handle("ocr-picker:start"',
    'ipcMain.on("ocr-picker:select"',
    'ipcMain.on("ocr-picker:cancel"',
    "recognizeOcrText",
    "scaleRectToThumbnail",
    "hasVisiblePixels",
    "getOcrResizeSize",
    "desktopCapturer",
    "function openLinkGroup(links)",
    "--new-window"
  ];
  const missingBackendContracts = requiredBackendContracts.filter((contract) => !backendContractSource.includes(contract));

  if (missingBackendContracts.length > 0) {
    throw new Error(`Missing local backend contracts: ${missingBackendContracts.join(", ")}`);
  }

  const requiredWindowContracts = [
    "width: 355",
    "height: 611",
    "frame: false",
    "-webkit-app-region: drag"
  ];
  const missingWindowContracts = requiredWindowContracts.filter((contract) => (
    !mainSource.includes(contract) && !rendererContractSource.includes(contract)
  ));

  if (missingWindowContracts.length > 0) {
    throw new Error(`Missing compact frameless window contracts: ${missingWindowContracts.join(", ")}`);
  }

  const requiredUiContracts = [
    '--accent: #B42318',
    'id="autoCaptureToggle"',
    'id="linkMenuButton"',
    'id="selectionToolbar"',
    'id="toggleSelectionPinsButton"',
    'id="deleteSelectionButton"',
    'id="inspectorDialog"',
    "function openEntryInspector(entry, listName)",
    "function deleteSelectedEntries()",
    "function toggleSelectedPins()",
    'id="linkDrawer"',
    'id="toggleLinkDrawerSizeButton"',
    'id="groupIconPicker"',
    'option.className = "group-icon-option"',
    'option.dataset.iconName = icon.name',
    'function selectGroupIcon(event)',
    'elements.groupIconPicker.addEventListener("click", selectGroupIcon)',
    "function getItemsFromSelection()",
    "splitClipboardBatch(entry.text, state.settings.batchSeparator)",
    'linkDrawerCompact',
    'function setLinkDrawerCompact',
    'getGroupDisplayModel',
    'id="batchSeparatorInput"',
    "function handleAutomaticClipboardEntry",
    "function createGroupFromSelection",
    "function updateSelection",
    "function splitClipboardBatch",
    "function joinClipboardBatch",
    "desktopApi.onClipboardChanged",
    "desktopApi.startImageDrag",
    "desktopApi.startColorPicker",
    "desktopApi.onColorPicked",
    "desktopApi.onLibraryConflict",
    'id="colorPickerButton"',
    'id="ocrButton"',
    'id="toolsMenuButton"',
    'id="toolsMenu"',
    'id="overflowColorPickerButton"',
    "function activateOcrPicker()",
    "function handleOcrResult(result)",
    "autoCapture: true",
    "linkGroups",
    "batchSeparator",
    'id="createMarkdownSnapshotButton"',
    'id="verifyMarkdownSnapshotButton"',
    'id="reloadMarkdownButton"',
    'id="openMarkdownDirectoryButton"',
    'id="storageHealthButton"',
    'id="appHealthButton"'
  ];
  const missingUiContracts = requiredUiContracts.filter((contract) => !rendererContractSource.includes(contract));

  if (missingUiContracts.length > 0) {
    throw new Error(`Missing UI contracts: ${missingUiContracts.join(", ")}`);
  }

  console.log("Syntax and desktop contract check: OK");
}
