# Clipboard Shelf Desktop App Design

## Goal

Wrap the existing local clipboard shelf in a real Windows desktop window that feels like a sticky note, while preserving its text/image shelf behavior and local-only storage.

## Decision

Use Electron as the desktop shell. It reuses the existing self-contained HTML immediately, supports native clipboard access through a small preload bridge, and can produce a portable Windows executable quickly. Tauri would produce a smaller binary but adds Rust/toolchain setup and a slower first delivery; a legacy HTA/WebView wrapper would be Windows-only and provide weaker modern clipboard behavior.

## User experience

- Launching the app opens a compact frameless window beside the user's work.
- The window is always on top by default, remains resizable, and has a small minimum size suitable for a narrow sticky note.
- The existing single gear button continues to contain shelf settings, backup, clear, and theme controls.
- The header also has only window controls: always-on-top toggle, minimize, and close. The title area is the drag handle for moving the window.
- Clicking anywhere in the shelf and pressing `Ctrl+V` adds the native clipboard text or image immediately. Focused-card `Ctrl+C`, card copy buttons, and drag-out remain non-destructive.
- No account, server, cloud sync, global OS clipboard monitor, auto-start, system tray, updater, or network request is added in this version.

## Architecture

The renderer remains `clipboard-shelf.html` and keeps its localStorage/IndexedDB state model. `main.cjs` owns the BrowserWindow lifecycle, window bounds, frameless-window policy, and native clipboard/window commands. `preload.cjs` exposes a minimal `window.desktopBridge` through `contextBridge`; it contains no arbitrary filesystem or shell access.

The bridge exposes:

- `readClipboard()` returning the current native text or image data URL.
- `writeText(text)` and `writeImage(dataUrl)` for native clipboard writes.
- `minimizeWindow()`, `closeWindow()`, `setAlwaysOnTop(enabled)`, and `getAlwaysOnTop()`.

The renderer uses the bridge when present and retains the browser Clipboard API/fallbacks when opened as a standalone HTML file. This keeps the HTML useful independently and makes the packaged app reliable on local-file clipboard permissions.

## Packaging

- `package.json` defines the app entry point and scripts for `start`, syntax checks, and a portable Windows build.
- `electron-builder` creates a portable executable under `dist/` without an installer or server.
- Runtime resources are local only; the packaged application has no external asset or request dependency.
- `userData` stores only Electron window preferences. Shelf entries remain in the renderer's localStorage/IndexedDB profile.

## Security and failure handling

- Enable `contextIsolation`, disable `nodeIntegration`, and restrict navigation and new-window creation to the local renderer document.
- The preload bridge validates text/image data types before passing them to Electron's clipboard API.
- Clipboard failures show the existing Arabic toast and leave shelf state unchanged.
- Window preference persistence failures do not prevent the app from opening.
- No imported shelf content is evaluated as code or HTML.

## Acceptance criteria

1. `npm start` opens a compact frameless window with the shelf visible.
2. The window is always on top by default, can be toggled from the header, can be moved by dragging its title area, can minimize, close, and resize down to the configured minimum.
3. Clicking the page then pressing `Ctrl+V` adds native clipboard text or an image as a new shelf card; the text remains exact and the image remains a tiny thumbnail.
4. Focused-card `Ctrl+C`, copy buttons, pin/unpin, delete/undo, normal 50-item cap, backups, and theme behavior remain available.
5. `npm run check` passes for the main process, preload, and inline renderer script.
6. `npm run build:portable` produces a Windows portable executable in `dist/`.
7. The source contains no network calls, external runtime dependencies, unsafe HTML assignment, or unrestricted renderer Node access.
