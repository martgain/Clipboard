# Clipboard Shelf Desktop App Design

## Goal

Turn the existing local clipboard shelf into a real Windows desktop app that stays close to a sticky note while preserving the current text/image shelf behavior.

## Recommendation

Use Electron as a thin local shell around the existing HTML. It is the fastest route because the renderer already exists, native clipboard access is available, and Electron Builder can produce a portable Windows executable. Tauri would be smaller but requires an additional Rust toolchain and more setup; a legacy HTA/WebView wrapper would be less reliable for modern clipboard/image behavior.

## User experience

- Open a compact frameless, resizable window beside the user's work.
- Keep the window always on top by default, with a small toggle in the title bar.
- Drag the window from its title area; provide compact minimize and close controls.
- Keep the existing gear as the only shelf-settings control. It continues to contain theme, backup, clear, and undo behavior.
- Clicking the shelf and pressing `Ctrl+V` adds native clipboard text or an image immediately. Focused-card `Ctrl+C`, card copy buttons, and drag-out remain non-destructive.
- Keep the app local: no server, account, cloud sync, global OS clipboard monitoring, auto-start, tray, updater, or runtime network request.

## Architecture

`clipboard-shelf.html` remains the renderer and retains localStorage/IndexedDB for shelf data. `main.cjs` owns the BrowserWindow, always-on-top state, window bounds, navigation policy, and native clipboard IPC. `preload.cjs` exposes only a small `window.desktopBridge` through `contextBridge` with no arbitrary filesystem, shell, or Electron access.

The bridge provides:

- `readClipboard()` returning native text or a PNG data URL for an image clipboard item.
- `writeText(text)` and `writeImage(dataUrl)`.
- `minimizeWindow()`, `closeWindow()`, `setAlwaysOnTop(enabled)`, and `getAlwaysOnTop()`.

The renderer calls the bridge when packaged and keeps browser Clipboard API fallbacks when opened directly as HTML. This preserves the original browser version while avoiding local-file permission problems in the desktop build.

## Window and persistence choices

- Default window size: 360×620 CSS pixels.
- Minimum window size: 210×260 CSS pixels so the sticky-note layout remains usable.
- Frameless window with a draggable title region; the content itself remains scrollable.
- Always-on-top defaults to enabled and is persisted with window bounds in Electron's userData directory.
- The app is portable and does not install a background service or start with Windows.

## Packaging and security

- `package.json` provides `start`, `check`, and `build:portable` scripts.
- Electron Builder creates a portable x64 Windows executable under `dist/`.
- `contextIsolation` is enabled, `nodeIntegration` is disabled, and navigation/new windows are denied unless they remain the local renderer document.
- The preload validates bridge arguments; failures show the existing Arabic toast and leave shelf state unchanged.

## Acceptance criteria

1. `npm start` opens the shelf in a compact frameless window.
2. The window stays above other windows by default, can toggle that behavior, moves from its title area, minimizes, closes, and resizes down to the minimum.
3. Clicking the page then pressing `Ctrl+V` adds native text or an image immediately; text stays exact and images stay tiny.
4. Existing shelf features remain available: Pins, normal 50-item cap, undo, theme, backup, copy, drag, and local persistence.
5. `npm run check` passes for main, preload, and renderer syntax plus bridge contracts.
6. `npm run build:portable` creates a portable Windows executable in `dist/`.
7. No network calls, external runtime assets, unsafe HTML assignment, unrestricted renderer Node access, or global clipboard monitor are introduced.
