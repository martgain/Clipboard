# Clipboard Shelf Link Groups and Multi-Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add editable Chrome link groups, Ctrl/Shift card selection, delimiter-based batch clipboard splitting, and durable local desktop storage while preserving the existing compact shelf.

**Architecture:** Keep the HTML renderer and secure Electron shell, extract pure batch and selection rules into CommonJS modules, and add a main-process JSON-plus-media store with atomic writes. The renderer uses typed IPC in desktop mode and retains its current browser-only storage fallback.

**Tech Stack:** Electron 37, Electron Builder, vanilla HTML/CSS/JavaScript, Node CommonJS, local JSON, filesystem media, localStorage/IndexedDB fallback.

**Spec:** `docs/superpowers/specs/2026-08-30-link-groups-selection-design.md`

## Global Constraints

- Local-only: no server, account, cloud sync, runtime network request, background monitor after close, startup registration, tray, or global hotkey.
- Preserve exact text content, tiny image thumbnails, Pins, normal 50-item cap, undo, theme, browser fallback, and 355×611 default window.
- Default batch separator is `<<<CLIPBOARD-ITEM>>>` on its own line; empty segments are ignored.
- Chrome opening must reject non-HTTP(S) URLs before launching.
- Renderer Node access remains disabled; every IPC handler validates its sender and arguments.
- Use `apply_patch` for source edits, preserve the existing dirty changes, and do not overwrite user data.
- Every production behavior change gets a failing test before implementation; run the relevant guard reviews before delivery.

## File Map

- Create: `clipboard-batch.cjs` — pure batch split/join functions.
- Create: `selection-model.cjs` — pure Ctrl/Shift selection transitions.
- Create: `library-store.cjs` — versioned JSON metadata and image-file persistence.
- Modify: `main.cjs` — initialize store, expose library/media IPC, and launch validated Chrome URL groups.
- Modify: `preload.cjs` — expose typed library/media/group methods.
- Modify: `clipboard-shelf.html` — async desktop initialization, new state fields, multi-select UI, menu drawer, group editor, batch integration, and backup migration.
- Modify: `tests/syntax-check.cjs` — syntax, contract, and feature presence checks.
- Create: `tests/clipboard-batch.test.cjs` — parser/join behavior tests.
- Create: `tests/selection-model.test.cjs` — Ctrl/Shift selection tests.
- Create: `tests/library-store.test.cjs` — real temporary-directory persistence and migration tests.
- Modify: `package.json` — add a test script that runs all Node tests and the existing contract check.
- Modify: `docs/superpowers/specs/2026-08-30-link-groups-selection-design.md` and this plan only if implementation decisions materially change.

### Task 1: Lock the pure clipboard and selection contracts

**Files:**
- Create: `tests/clipboard-batch.test.cjs`
- Create: `tests/selection-model.test.cjs`
- Create: `clipboard-batch.cjs`
- Create: `selection-model.cjs`

**Interfaces:**
- `splitClipboardBatch(text, separator) -> string[]` splits only complete separator lines and preserves segment text.
- `joinClipboardBatch(items, separator) -> string` joins non-empty text items with complete separator lines.
- `updateSelection({ selectedIds, anchorId, clickedId, orderedIds, ctrlKey, shiftKey }) -> { selectedIds, anchorId }` returns deterministic ordered selection state.

- [ ] **Step 1: Write failing batch tests** for no separator, multiple separators, CRLF input, empty segments, and exact spaces/newlines around content.
- [ ] **Step 2: Run `node --test tests/clipboard-batch.test.cjs`** and confirm failure because `clipboard-batch.cjs` does not exist.
- [ ] **Step 3: Write the minimal parser/joiner** with a complete-line escaped regular expression and no trimming beyond separator removal.
- [ ] **Step 4: Run the batch test and confirm PASS.**
- [ ] **Step 5: Write failing selection tests** for plain click, Ctrl non-contiguous toggle, Shift inclusive range, reverse range, and Ctrl+Shift range extension.
- [ ] **Step 6: Run `node --test tests/selection-model.test.cjs`** and confirm failure because `selection-model.cjs` does not exist.
- [ ] **Step 7: Implement the minimal selection transition function** without DOM dependencies.
- [ ] **Step 8: Run both test files and confirm PASS.**

### Task 2: Add the local backend store and safe IPC surface

**Files:**
- Create: `tests/library-store.test.cjs`
- Create: `library-store.cjs`
- Modify: `main.cjs`
- Modify: `preload.cjs`

**Interfaces:**
- `createLibraryStore({ dataFile, mediaDirectory }) -> { load(), save(library), writeImage(mediaKey, dataUrl), readImage(mediaKey), deleteImage(mediaKey), migrateLegacy(library, images) }`.
- Preload methods: `loadLibrary`, `saveLibrary`, `writeLibraryImage`, `readLibraryImage`, `deleteLibraryImage`, `openLinkGroup`.

- [ ] **Step 1: Write failing store tests** using a real temporary directory for atomic metadata save/load, schema defaults, image write/read/delete, and failed malformed input preservation.
- [ ] **Step 2: Run `node --test tests/library-store.test.cjs`** and confirm failure because the store module does not exist.
- [ ] **Step 3: Implement the store** with `schemaVersion: 2`, JSON temp-file rename, base64 image validation, opaque media-key path containment, and duplicate-safe normalized defaults.
- [ ] **Step 4: Run the store tests and confirm PASS.**
- [ ] **Step 5: Add failing IPC contract assertions** for the new preload names, trusted renderer checks, and main-process handlers.
- [ ] **Step 6: Implement main/preload integration** while preserving existing clipboard polling and window preferences.
- [ ] **Step 7: Run the focused tests plus `npm run check`** and confirm the bridge and syntax remain valid.

### Task 3: Integrate desktop persistence and migration in the renderer

**Files:**
- Modify: `clipboard-shelf.html`
- Modify: `tests/syntax-check.cjs`

**Interfaces:**
- Desktop startup calls `await desktopApi.loadLibrary()` before the first render.
- Desktop saves call `desktopApi.saveLibrary(serializableState)`; browser mode keeps the existing localStorage path.
- Image helpers use `desktopApi.writeLibraryImage/readLibraryImage/deleteLibraryImage` in Electron mode and IndexedDB otherwise.

- [ ] **Step 1: Add failing source contracts** requiring `linkGroups`, `batchSeparator`, async desktop library initialization, and preservation of the browser fallback.
- [ ] **Step 2: Run `npm run check`** and confirm failure on the missing contracts.
- [ ] **Step 3: Refactor renderer initialization minimally** so desktop state is loaded before rendering and current renderer state is migrated once when no desktop library exists.
- [ ] **Step 4: Route image persistence through the desktop bridge** without removing IndexedDB fallback.
- [ ] **Step 5: Run `npm run check` and the Node test suite.**
- [ ] **Step 6: Confirm existing duplicate, pin, 50-item, undo, theme, image, and backup behavior still uses the unified state.**

### Task 4: Implement Ctrl/Shift multi-select and batch clipboard integration

**Files:**
- Modify: `clipboard-shelf.html`
- Modify: `tests/syntax-check.cjs`

**Interfaces:**
- Cards expose `data-entry-id` and `data-list-name`, and selection is held in a transient `selectedCardKeys` set plus `selectionAnchorKey`.
- `handleAutomaticClipboardEntry` and `pasteFromClipboard` call `splitClipboardBatch` for text payloads.
- The contextual toolbar invokes `createGroupFromSelection`, `copySelectedAsBatch`, and `clearSelection`.

- [ ] **Step 1: Add failing renderer contracts** for Ctrl/Shift handling, selected-card styling, contextual actions, and batch parser usage.
- [ ] **Step 2: Run `npm run check`** and confirm failure.
- [ ] **Step 3: Add card click handling** that ignores action buttons, delegates selection transitions to `updateSelection`, and renders selection state without changing persisted data.
- [ ] **Step 4: Add the contextual toolbar** that is hidden when no cards are selected.
- [ ] **Step 5: Integrate batch parsing** into manual paste and automatic capture; preserve exact segment text and apply normal-list dedupe/limit rules to each segment.
- [ ] **Step 6: Add batch-copy behavior** that writes one joined payload and keeps the selected cards in the shelf.
- [ ] **Step 7: Run all tests and manually verify Arabic and English keyboard layouts.**

### Task 5: Implement the link drawer, group editor, and Chrome launcher

**Files:**
- Modify: `clipboard-shelf.html`
- Modify: `main.cjs`
- Modify: `preload.cjs`
- Modify: `tests/syntax-check.cjs`

**Interfaces:**
- Group shape: `{ id, name, links: string[], createdAt, updatedAt }`.
- Renderer actions: `createLinkGroup`, `updateLinkGroup`, `deleteLinkGroup`, `moveLinkInGroup`, `openLinkGroup`.
- Main handler validates each URL and launches one Chrome process with `--new-window` plus the URL arguments.

- [ ] **Step 1: Add failing UI/source contracts** for the menu button, overlay drawer, group list, group editor, selected-URL extraction, and `openLinkGroup` bridge call.
- [ ] **Step 2: Run `npm run check`** and confirm failure.
- [ ] **Step 3: Add minimal overlay markup and CSS** that preserves the compact layout and only occupies the window when opened.
- [ ] **Step 4: Implement group CRUD** with name validation, URL validation, duplicate prevention, stable ordering, and persistence through the unified state.
- [ ] **Step 5: Implement “save selected as group”** and skip/report non-URL cards.
- [ ] **Step 6: Implement the Windows Chrome resolver and safe process launch** with clear error handling and a default-browser fallback action.
- [ ] **Step 7: Run source contracts and the full Node test suite.**

### Task 6: Extend backup/import and settings without UI clutter

**Files:**
- Modify: `clipboard-shelf.html`
- Modify: `tests/syntax-check.cjs`

- [ ] **Step 1: Add failing backup contracts** requiring link groups and batch separator export/import, plus malformed-group rejection.
- [ ] **Step 2: Run `npm run check`** and confirm failure.
- [ ] **Step 3: Extend export/import** with `linkGroups` and `batchSeparator`, keeping old backups valid and preserving the existing merge, dedupe, and 50-item cap behavior.
- [ ] **Step 4: Add settings controls** for separator editing and group management while keeping the visible main surface minimal.
- [ ] **Step 5: Run all tests and verify importing a legacy backup does not erase current pins or normal entries.**

### Task 7: Full verification, packaging, and handoff

**Files:**
- Modify: `package.json`
- Modify: `tests/syntax-check.cjs`
- Create or update only if needed: `README.md`

- [ ] **Step 1: Add a `test` script** that runs all Node tests and the existing syntax/contract check.
- [ ] **Step 2: Run `npm test`** and fix only failures caused by this feature.
- [ ] **Step 3: Run the clean-code, test, and docs guard reviews** against the changed production code, tests, and technical documentation; fix actionable findings and rerun the guards.
- [ ] **Step 4: Build with `npm run build:portable`** and confirm the portable executable is generated.
- [ ] **Step 5: Run a real Windows smoke test** covering automatic text/image capture, Ctrl+V, Ctrl+C, Ctrl/Shift selection, group CRUD, Chrome tabs, batch splitting, restart persistence, backup/import, resize, always-on-top, and close cleanup.
- [ ] **Step 6: Verify the packaged `app.asar` contains the new modules and contains no test-only hooks.**
- [ ] **Step 7: Record the final executable path, size, SHA-256, test output, smoke output, and any remaining limitation.**
