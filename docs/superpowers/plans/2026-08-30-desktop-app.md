# Clipboard Shelf Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package the existing static clipboard shelf as a compact local Windows desktop app with native clipboard access and sticky-note window behavior.

**Architecture:** Keep `clipboard-shelf.html` as the renderer and add a minimal Electron main process plus isolated preload bridge. The bridge handles native clipboard and window commands; the renderer falls back to browser APIs when opened directly. Electron Builder produces a portable Windows executable.

**Tech Stack:** Electron, Electron Builder, vanilla HTML/CSS/JavaScript, contextBridge, Electron clipboard/nativeImage, localStorage, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-08-30-desktop-app-design.md`

## Global Constraints

- Local-only: no server, login, account, cloud sync, global clipboard monitor, auto-start, tray, updater, or network request.
- Preserve exact text, tiny image thumbnails, numbered cards, Pins, normal 50-item cap, undo, theme, and JSON backup behavior.
- Keep renderer Node access disabled; expose only the listed typed bridge methods.
- The HTML must still open independently in a browser.
- Use `apply_patch` for source edits and do not commit from delegated workers.

## File Map

- Modify: `clipboard-shelf.html` — add desktop drag region, window controls, and native bridge fallbacks.
- Create: `main.cjs` — BrowserWindow lifecycle, preferences, navigation policy, and IPC handlers.
- Create: `preload.cjs` — minimal context-isolated clipboard/window bridge.
- Create: `package.json` — scripts, Electron entry point, and portable build configuration.
- Create: `tests/syntax-check.cjs` — parses main, preload, and the inline renderer script without running the app.

### Task 1: Add the Electron project shell

- [ ] Write the failing syntax-check test that loads the expected files and reports missing files.
- [ ] Run `npm run check` and observe the expected missing-file failure.
- [ ] Add `package.json`, `main.cjs`, `preload.cjs`, and `tests/syntax-check.cjs` with the exact scripts and secure BrowserWindow configuration from the spec.
- [ ] Run `npm run check` and verify all three JavaScript contexts parse successfully.

### Task 2: Add native clipboard and window controls

- [ ] Add the isolated `window.desktopBridge` methods in `preload.cjs` and corresponding IPC handlers in `main.cjs`.
- [ ] Run the syntax check and inspect the bridge surface for only the approved methods.
- [ ] Add compact, draggable window controls to the HTML and make them call the bridge when available.
- [ ] Keep the gear button as the only shelf-settings control and preserve standalone-browser behavior.

### Task 3: Wire native clipboard into the shelf

- [ ] Add native bridge preference to the renderer's paste path, converting returned image data URLs to the existing Blob/IndexedDB path.
- [ ] Add native bridge preference to text and image copy paths, retaining existing browser fallbacks.
- [ ] Run source checks for exact clipboard paths, safe rendering, and no external requests.

### Task 4: Package and verify the desktop app

- [ ] Install the pinned development dependencies from `package.json`.
- [ ] Run `npm run check` and `npm run build:portable`.
- [ ] Launch with `npm start` and verify the visible compact window, always-on-top toggle, drag handle, minimize, close, resize, click-then-`Ctrl+V`, card copy, image thumbnail, and persistence behavior.
- [ ] Confirm the portable executable exists under `dist/` and record its path and hash.
- [ ] Commit only after source, packaging, and visible smoke checks pass.
