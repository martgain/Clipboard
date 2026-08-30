# Clipboard Shelf Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single self-contained static HTML clipboard shelf that stores exact plain text and local images, previews each item in one compact numbered line, supports full-content copy/read-more/drag-and-drop, and separates protected Pins from a capped normal history.

**Architecture:** Keep all markup, CSS, and JavaScript in `clipboard-shelf.html` so the user can open it directly from any modern browser without installation or network access. Persist text metadata in `localStorage` and image Blobs in IndexedDB, render both lists from state, and route all mutations through focused functions that enforce deduplication, Pin precedence, undo, and the 50-item normal limit.

**Tech Stack:** Semantic HTML, inline CSS with CSS custom properties, vanilla JavaScript, `localStorage`, IndexedDB, File API, Clipboard API with plain-text/image fallbacks, and HTML5 drag-and-drop.

**Spec:** `docs/superpowers/specs/2026-08-30-clipboard-shelf-design.md`

## Global Constraints

- One directly-openable HTML file containing the application markup, styles, and JavaScript.
- The interface is a compact sticky-note-style utility with minimal visible copy, controls, and chrome; one gear button contains the settings/actions. It must remain usable at roughly 10% of a desktop width with no horizontal overflow.
- Plain-text clipboard entries preserve line breaks, spaces, symbols, emoji, and URL text.
- Image entries are accepted by paste and drag/drop, stored locally, and rendered as tiny thumbnails without enlarging the source image.
- Text cards show one preview line with a read-more arrow; expanded cards show the complete value and can collapse again. Every card has a visible sequence number.
- Dragging a text entry out sends complete `text/plain` content; dragging an image sends image/file data where the browser permits; both leave the stored entry unchanged.
- Normal-list capacity is fixed at 50 entries; Pins are unlimited and removed only individually.
- Duplicate detection compares exact stored plain-text values or image content signatures and moves existing entries to the top.
- Import is merge-based, gives Pin membership precedence, and applies the 50-entry normal cap.
- Clear-all normal requires confirmation and provides a temporary undo action without touching Pins.
- Persistence is local to the same browser profile; export/import is the cross-browser transfer mechanism.
- No network requests, external runtime dependencies, rich HTML rendering, or automatic OS clipboard monitoring.
- Clicking anywhere on the page activates it; page-local `Ctrl/Cmd+V` then adds clipboard text or an image immediately. Page-local `Ctrl/Cmd+C` copies the focused entry completely. Global copy capture outside the active page is not possible in Static HTML.
- Text is rendered as text and never evaluated as markup or code; image previews use local Blob object URLs only.

## File Map

- Create: `clipboard-shelf.html` — complete application shell, responsive RTL UI, state engine, storage, clipboard, drag-and-drop, theme, and backup behavior.
- Modify: none.
- Test: browser smoke verification against `clipboard-shelf.html`; source-level checks for external requests and unsafe HTML rendering.

### Task 1: Create the self-contained page shell and visual system

**Files:**
- Create: `clipboard-shelf.html`

**Interfaces:**
- Produces compact DOM regions with IDs `app`, `pinnedList`, `normalList`, `pinnedEmpty`, `normalEmpty`, `settingsButton`, `settingsDialog`, `themeToggle`, `exportButton`, `importButton`, `importInput`, `clearNormalButton`, and `toastRegion`; the page surface itself is the drag target and has no dedicated drop control.
- Produces CSS custom properties for light/dark themes and a responsive two-section layout.

- [x] **Step 1: Add the HTML document shell**

Create a valid HTML5 document with `lang="ar"`, `dir="rtl"`, a viewport meta tag, an inline `<style>`, and an inline `<script>`. Use semantic `header`, `main`, `section`, `dialog`, `button`, and `output` elements with no dedicated drop control; the page surface itself accepts drag-and-drop. Put theme, backup, and clear-normal controls inside `settingsDialog`, opened by the only persistent utility control, `settingsButton`. Do not add external stylesheets, fonts, scripts, images, or tracking.

- [x] **Step 2: Add the visual tokens and responsive layout**

Define light and dark CSS variables on `:root` and `[data-theme="dark"]`, then style the page as a narrow sticky-note surface with compact numbered rows, restrained borders, and no explanatory paragraphs or large form panels. Keep the header to a title, counts, and one gear button; keep settings hidden in a compact dialog. Use one-line text previews with a read-more arrow, tiny fixed image thumbnails, `min-width: 0`, `overflow-wrap: anywhere`, compact icon-like controls, and fluid wrapping so the page remains usable around 10% of a desktop width without horizontal overflow. Keep cards readable at desktop width. Use a whitespace-preserving class for expanded text and visible focus states for every button, card, and the whole page drop surface.

- [x] **Step 3: Open the file for a shell smoke check**

Run: `Start-Process 'D:\work\برنامج الكوبي\clipboard-shelf.html'`

Expected: the file opens as a standalone page with an Arabic RTL header, empty Pins and normal sections, accepts click-then-paste anywhere, and makes no external-resource request in the source.

### Task 2: Implement normalized state, persistence, and safe text utilities

**Files:**
- Modify: `clipboard-shelf.html` inside the inline script

**Interfaces:**
- `createDefaultState(): AppState`
- `normalizeState(raw: unknown): AppState`
- `loadState(): AppState`
- `saveState(state: AppState): Promise<void>`
- `makeEntry(text: string, now?: number): TextEntry`
- `isNonEmptyText(value: unknown): value is string`
- `openImageDb(): Promise<IDBDatabase>`
- `putImageBlob(blobKey: string, blob: Blob): Promise<void>`
- `getImageBlob(blobKey: string): Promise<Blob|null>`
- `deleteImageBlob(blobKey: string): Promise<void>`

Use this JavaScript shape throughout the file:

```js
// TextEntry: { id: string, type: 'text', text: string, createdAt: number, updatedAt: number }
// ImageEntry: { id: string, type: 'image', image: { blobKey: string, mimeType: string, size: number, hash: string }, createdAt: number, updatedAt: number }
// AppState: {
//   schemaVersion: 1,
//   settings: { theme: 'light'|'dark', duplicatePolicy: 'dedupe-move-to-top', normalLimit: 50 },
//   pinned: (TextEntry|ImageEntry)[],
//   normal: (TextEntry|ImageEntry)[]
// }
```

- [x] **Step 1: Implement the default state and validation helpers**

Set `schemaVersion` to `1`, `duplicatePolicy` to `'dedupe-move-to-top'`, `normalLimit` to `50`, and default theme to `'light'`. Accept only non-empty strings for entry text; preserve every character exactly and do not trim accepted content. Accept only `image/*` Blobs for image payloads and preserve their original MIME type and bytes in IndexedDB.

- [x] **Step 2: Implement normalization and migration-safe loading**

Make `normalizeState` reject malformed top-level data by returning a fresh default state, filter malformed text/image metadata, repair missing IDs/timestamps, deduplicate exact text or image keys, give Pins precedence, and retain only the newest 50 normal entries. `loadState` catches JSON/storage errors without breaking page startup; image Blobs are loaded lazily for thumbnails and copy actions.

- [x] **Step 3: Implement atomic local persistence**

Make `saveState` serialize normalized metadata once and write it under the namespaced key `clipboard-shelf-state-v1`; image Blobs are stored through `putImageBlob` before their metadata is committed. Catch quota/security/IndexedDB failures, keep the in-memory state available, and route a concise Arabic storage-error message to the toast region.

- [x] **Step 4: Run source-level safety checks**

Run: `rg -n "fetch\\(|XMLHttpRequest|<script[^>]+src=|<link[^>]+href=|innerHTML|eval\\(" 'D:\\work\\برنامج الكوبي\\clipboard-shelf.html'`

Expected: no network/runtime dependency matches and no use of unsafe HTML assignment or code evaluation.

### Task 3: Implement the clipboard shelf mutation engine

**Files:**
- Modify: `clipboard-shelf.html` inside the inline script

**Interfaces:**
- `addText(text: string, targetList?: 'normal'|'pinned'): boolean`
- `addImage(blob: Blob, targetList?: 'normal'|'pinned'): Promise<boolean>`
- `togglePin(id: string): void`
- `deleteEntry(listName: 'normal'|'pinned', id: string): void`
- `clearNormalWithUndo(): void`
- `undoLastDeletion(): void`
- `enforceNormalLimit(): void`
- `findEntryByText(text: string): { listName: 'normal'|'pinned', entry: Entry }|null`
- `findEntryBySignature(signature: string): { listName: 'normal'|'pinned', entry: Entry }|null`

- [x] **Step 1: Implement exact-text deduplication and ordering**

When `addText` or `addImage` receives an existing exact text value or image content signature, remove the existing copy from whichever list owns it, update `updatedAt`, and reinsert it at the top of that same list. If the value exists in Pins, never create or retain a normal copy. Reject empty/whitespace-only text and non-image files without changing state.

- [x] **Step 2: Implement Pin movement and the normal cap**

Make `togglePin` move the selected entry between lists, keep its text unchanged, place it at the top of the destination list, and call `enforceNormalLimit` after unpinning. Pins never count toward the cap. `enforceNormalLimit` removes the oldest normal entries until the length is at most 50.

- [x] **Step 3: Implement individual delete and temporary undo**

Store the most recent deleted entry or clear snapshot in an in-memory undo record with a short expiry timer. Individual Pin deletion must be explicit and must not be caused by normal-list cleanup. `clearNormalWithUndo` must require `window.confirm`, save the complete normal snapshot, clear only normal entries, and expose the undo action through the toast region.

- [x] **Step 4: Wire mutations to render/save hooks**

After every successful add, Pin move, delete, clear, undo, or import mutation, normalize state, persist it, render both lists, update counts, and show a short Arabic status message. Failed operations must leave the previous state intact.

### Task 4: Build rendering, paste, copy, and drag-and-drop interactions

**Files:**
- Modify: `clipboard-shelf.html` inside the inline script and entry-card markup

**Interfaces:**
- `render(): void`
- `renderList(listName: 'normal'|'pinned', entries: Entry[]): void`
- `copyText(text: string): Promise<boolean>`
- `handleDrop(event: DragEvent): void`
- `handleEntryDragStart(event: DragEvent, entry: Entry): void`

- [x] **Step 1: Render cards as safe plain text**

Use `document.createElement`, `textContent`, and safe image attributes for all user values. Each card must carry its entry ID, show a visible sequence number, display text as exactly one preview line with an expand/collapse arrow, or display an original image in a tiny fixed thumbnail, be draggable, expose compact icon actions, and use Arabic accessible labels. Render empty-state messages and counts for both lists.

- [x] **Step 2: Add paste and drop-in handling**

Listen for `dragover` and `drop` on the whole page surface (`document`/`body`) and for page-local `keydown` events. Make the body focusable and focus it after a click on any non-control page area so the next `Ctrl/Cmd+V` is handled by the page. Read `text/plain` for text plus `image/*` File/Blob payloads for images, prevent default browser navigation, add a non-empty payload immediately, and reject unsupported non-image files/rich payloads with a short message. For `Ctrl/Cmd+V`, call `navigator.clipboard.read()` when available so image clipboard items are accepted, fall back to `navigator.clipboard.readText()` for text, add the returned payload immediately, and show a concise error when permission is unavailable. Do not add a permanently visible textarea or a dedicated drop button.

- [x] **Step 3: Add full-text copy with fallback**

Implement text copy with `navigator.clipboard.writeText(text)` first, then a temporary off-screen textarea fallback for local-file contexts. For image cards, load the stored Blob and attempt `navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])`; drag-out must also expose the image as a best-effort file/URI payload. Report success/failure in the toast region; never alter the source card.

- [x] **Step 4: Add non-destructive drag-out**

On text card drag start, set `event.dataTransfer.effectAllowed = 'copy'` and set `text/plain` to the exact entry text. On image card drag start, add the original image File/Blob where supported and set a best-effort `DownloadURL`/URI payload. Do not delete or mutate the source entry. On drag end, remove only transient visual styling.

- [x] **Step 5: Add page-local keyboard copy**

Make each entry card focusable. When a focused card receives `Ctrl/Cmd+C`, call the text or image copy path with that card’s complete value and prevent the browser’s default copy event. Do not claim or attempt to intercept copy events from other applications or inactive pages.

- [ ] **Step 6: Run the interaction smoke check**

Open the file and verify a click anywhere on the page followed by `Ctrl/Cmd+V` adds a multiline value containing spaces, emoji, symbols, and a URL, shown as one preview line, expanded with the read-more arrow, dragged into a compatible text field as one complete value, copied with focused-card `Ctrl/Cmd+C` or the small Copy affordance, and dragged back into the app as a new or deduplicated entry. Also verify an image can be dropped/pasted, remains a tiny thumbnail, and can be dragged/copied where supported.

### Task 5: Add theme, backup merge, and final page wiring

**Files:**
- Modify: `clipboard-shelf.html` inside the inline script

**Interfaces:**
- `applyTheme(theme: 'light'|'dark'): void`
- `toggleTheme(): void`
- `exportBackup(): void`
- `importBackup(file: File): Promise<void>`
- `mergeImportedState(incoming: AppState): void`

- [x] **Step 1: Implement persistent light/dark mode**

Make the theme toggle update `document.documentElement.dataset.theme`, update its accessible label, persist the setting, and restore it during startup. Use the light theme by default.

- [x] **Step 2: Implement safe JSON export**

Serialize the versioned state, read image Blobs into base64 data URLs for the backup, create a `Blob` with `application/json`, trigger a download with a timestamped filename, and release the object URL. Keep the state unchanged if image serialization or download creation fails.

- [x] **Step 3: Implement transactional merge import**

Read the selected file as text, parse and validate it completely before mutation, reconstruct image Blobs from base64 data URLs, merge Pins first, skip exact text/image duplicates, give Pin membership precedence, retain newest normal entries within 50, persist once, and report the result. On any error, keep the current state and show an Arabic error message.

- [x] **Step 4: Initialize and wire all controls**

Load state, apply theme, bind whole-page paste/drop, settings dialog open/close, button, keyboard, drag, import, and `beforeunload`-safe handlers, then call `render`. Keep settings controls hidden until `settingsButton` opens `settingsDialog`. Do not use `beforeunload` as the primary persistence mechanism; every mutation saves immediately.

### Task 6: Verify the finished static artifact and record the result

**Files:**
- Verify: `clipboard-shelf.html`

- [x] **Step 1: Run static source checks**

Run: `rg -n "fetch\\(|XMLHttpRequest|<script[^>]+src=|<link[^>]+href=|innerHTML|eval\\(" 'D:\\work\\برنامج الكوبي\\clipboard-shelf.html'`

Expected: no external runtime dependency, unsafe HTML assignment, or code-evaluation match.

- [ ] **Step 2: Run the complete Chrome smoke test**

Verify: text/image paste/drop-in anywhere on the page, exact whitespace display, one-line text preview plus read-more expansion, visible card sequence numbers, tiny image thumbnails, full text/image copy where supported, non-destructive text/image drag-out, dedupe-to-top, Pin/unpin movement, 51-item normal retention, Pin survival, clear confirmation and undo from inside the gear dialog, individual Pin deletion, reload persistence including images, settings dialog open/close, light/dark persistence from settings, JSON export/import including images, Pin precedence, normal cap after import, invalid-import rollback, and a narrow viewport around 10% desktop width with no horizontal overflow and a usable full-page drop surface/settings dialog.

- [x] **Step 3: Inspect the final diff and status**

Run: `git diff --check HEAD~1..HEAD; git status --short`

Expected: no whitespace errors; only the intended HTML, spec, and plan files are present, with no generated cache or dependency directories.

- [x] **Step 4: Commit the implementation**

```powershell
git add -- clipboard-shelf.html
git commit -m "feat: add local clipboard shelf"
```
