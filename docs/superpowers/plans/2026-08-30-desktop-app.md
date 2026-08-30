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
- Create: `tests/syntax-check.cjs` — parses main, preload, and the inline renderer script plus bridge contracts.

### Task 1: Establish a failing syntax and contract check

- [ ] Add `tests/syntax-check.cjs` that requires `main.cjs`, `preload.cjs`, and `clipboard-shelf.html`, and asserts that each JavaScript context parses. Also assert that the package scripts and bridge method names exist.
- [ ] Run `node tests/syntax-check.cjs` and observe failure because the Desktop files do not yet exist.

### Task 2: Build the secure Electron shell

- [ ] Add `package.json` with `main`, `start`, `check`, and `build:portable` scripts plus portable x64 Electron Builder configuration.
- [ ] Add `main.cjs` with a 360×620 frameless BrowserWindow, 210×260 minimum size, always-on-top default, persisted bounds/preferences, denied navigation/new windows, and IPC handlers for clipboard and window actions.
- [ ] Add `preload.cjs` with `contextBridge` methods limited to the approved `desktopBridge` surface.
- [ ] Run the syntax/contract check and verify main/preload parse without executing Electron APIs in the test process.

### Task 3: Connect the renderer to native desktop behavior

- [ ] Add a draggable title region and compact minimize/always-on-top/close controls to `clipboard-shelf.html`; hide them when the file is opened outside Electron.
- [ ] Prefer `window.desktopBridge.readClipboard()` for desktop paste and `writeText`/`writeImage` for desktop copy, preserving browser fallbacks and all existing shelf rules.
- [ ] Run source checks for exact text preservation, safe rendering, no external requests, and disabled renderer Node access.

### Task 4: Install, package, launch, and verify

- [ ] Install Electron and Electron Builder from `package.json`.
- [ ] Run `npm run check` and `npm run build:portable`.
- [ ] Launch with `npm start` and verify the visible window, always-on-top toggle, drag handle, minimize, close, resize, click-then-`Ctrl+V`, focused-card copy, image thumbnail, and persistence behavior.
- [ ] Confirm the portable executable exists under `dist/` and record its path and SHA-256.
- [ ] Commit only after source, packaging, and visible smoke checks pass.
