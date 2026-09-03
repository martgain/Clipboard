# Selected Clipboard Shelf Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** تنفيذ اختيارات المستخدم الجديدة فقط بعد تدقيق الموجود، مع إضافة 21 تطويرًا/ميزة جديدة والحفاظ على 13 ميزة مثبتة بلا إعادة بناء.

**Architecture:** نضيف وحدات pure صغيرة للبحث والتحويل والنماذج، ونوسع storage/Markdown بإصدارات متوافقة، ثم نربطها عبر bridge ضيق وrenderer adapter. تبقى Markdown canonical، media داخل workspace، وtransaction generations/backup snapshots مسار الحماية؛ لا نلمس الوظائف المصنفة موجودًا إلا بإضافة regression coverage.

**Tech Stack:** Electron 44، Node.js CommonJS في main/shared، ES modules محلية في renderer، Node test runner، Markdown محلي، media content-addressed، native Windows APIs الحالية عند الحاجة، وelectron-builder checks الموجودة.

**Spec:** `docs/superpowers/specs/2026-09-03-selected-features-design.md`

## Global Constraints

- التطبيق local-only؛ لا cloud، لا telemetry، ولا إرسال clipboard/OCR إلى الإنترنت.
- النص يُحفظ حرفيًا؛ أي تنظيف أو تحويل ينتج نسخة مشتقة ولا يكتب فوق الأصل.
- الحد للعادي ثابت 150 عنصرًا؛ Pins والمجموعات لا تتأثر إلا بسياسة صريحة.
- backup/restore وmigration لا يحذفان بيانات المستخدم قبل نسخة قابلة للتحقق وhashes.
- RTL افتراضيًا، والبحث يطبع عربيًا دون تغيير القيمة الأصلية.
- كل IPC يتحقق من sender والـpayload؛ لا HTML خام من clipboard في DOM.
- لا reset أو حذف شامل للشجرة المتسخة؛ كل تعديل يقتصر على ملفات المهمة.

## File map and ownership

- `search-query.cjs`, `search-index.cjs`, `library-filter.cjs`: parse/evaluate/score/highlight، بلا DOM أو IPC.
- `collections.cjs` أو facade قريب من `library-store.cjs`: parent/children/notes/collection metadata، مع migration.
- `markdown-library.cjs`: frontmatter، collection references، relative attachments، backward parser.
- `transform-service.cjs`, `color-picker.cjs`, `qr-detector.cjs`, `ocr-language.cjs`: derived output and recognition metadata.
- `transaction-store.cjs`, `version-history.cjs`, `ocr-index.cjs`: generation listing/restore and bounded background indexing.
- `src/renderer/app-state.js`, `app.js`, `render-library.js`, `collections.js`, `settings.js`: UI wiring only.
- `preload.cjs`, `src/shared/contracts.cjs`, `src/main/ipc/register-ipc.cjs`: allow-listed bridge and validation.
- `main.cjs`, `package.json`: native/runtime wiring and packaging entries only when required.
- `tests/`: one test file per pure unit or contract surface; no test deletes user directories outside its temp fixture.

## Status-only features: verify and skip implementation

### Task 0: Baseline and regression inventory

**Files:**

- Read: `docs/superpowers/specs/2026-09-03-selected-features-design.md`, current project rules, and the selected source/tests.
- Test: existing `tests/clipboard-service.test.cjs`, `tests/clipboard-batch.test.cjs`, `tests/selection-model.test.cjs`, `tests/renderer/selection-actions.test.cjs`, `tests/ocr-text.test.cjs`, `tests/ocr-pipeline.test.cjs`, `tests/color-picker.test.cjs`, `tests/storage-health.test.cjs`, `tests/ui-layout-and-limit.test.cjs`.

**Interfaces:** Consumes the current app; produces an audit report and a fixed baseline command result.

- [x] **Step 1:** Run `npm.cmd test` from the current branch and record the test count and exit code.
- [x] **Step 2:** Confirm IDs 1, 5, 10, 14, 21, 24, 30, 42, 46, 47, 82, 88, 91, 92, and 95 by reading source plus named tests; ID 95 duplicate is recorded once.
- [ ] **Step 3:** Add only missing regression assertions if a listed “existing” contract lacks a direct test; do not rewrite the implementation.
- [ ] **Step 4:** Record the no-op decisions in the final report and keep their files out of feature commits.

**Gate:** baseline remains green; no status-only feature is reimplemented.

## Implementation tasks

### Task 1: Paste Sequence and collection hierarchy

**Files:**

- Create: `paste-sequence.cjs`, `collection-tree.cjs`.
- Modify: `library-store.cjs`, `markdown-library.cjs`, `src/shared/contracts.cjs`, `preload.cjs`, `src/main/ipc/register-ipc.cjs`, `src/renderer/collections.js`, `src/renderer/app-state.js`.
- Test: `tests/paste-sequence.test.cjs`, `tests/collection-tree.test.cjs`, `tests/markdown-library.test.cjs`, `tests/library-store.test.cjs`, `tests/ipc-bridge-contract.test.cjs`.

**Interfaces:**

- `splitPasteSequence(entries, { separator, order }) -> string[]` keeps entry text exact and returns stable order.
- `buildPasteSequence(entries, options) -> { text, entries, separator }` produces one derived payload and never mutates entries.
- `validateCollectionTree(collections) -> normalizedCollections` rejects duplicate IDs, self-parent, cycles, and unknown parents.
- `moveCollection(collections, id, parentId) -> collections` returns a defensive clone with deterministic ordering.

- [ ] **Step 1:** Write failing tests for ordered multi-copy, empty entries, exact newlines, duplicate collection IDs, self-parent, cycles, and move-to-root.
- [ ] **Step 2:** Run `node --test tests/paste-sequence.test.cjs tests/collection-tree.test.cjs` and capture the expected missing-module failures.
- [ ] **Step 3:** Implement pure sequence and tree functions with explicit bounds and no filesystem access.
- [ ] **Step 4:** Extend persisted collection schema with optional `parentId`, keeping legacy linkGroups/smartCollections readable and preserving IDs.
- [ ] **Step 5:** Add Markdown serialization for nested collection metadata and parse old Markdown as root-level collections.
- [ ] **Step 6:** Add one bridge action for “paste sequence” that writes the derived text to the system clipboard; the existing copy behavior remains separate.
- [ ] **Step 7:** Wire collection drawer nesting and compact icon/expanded title without increasing card text density.
- [ ] **Step 8:** Run the focused tests, then `npm.cmd test` and inspect the diff for accidental data mutation.

**Acceptance:** Ctrl/Shift-selected entries can be copied as a deterministic sequence; nested collections survive save/load; invalid trees fail before Markdown write.

### Task 2: Notes, tags, bulk collection actions, and search metadata

**Files:**

- Create: `entry-metadata.cjs`.
- Modify: `library-store.cjs`, `markdown-library.cjs`, `src/shared/validation.cjs`, `src/renderer/bulk-actions.js`, `src/renderer/collections.js`, `src/renderer/app.js`, `src/renderer/inspector.js`.
- Test: `tests/entry-metadata.test.cjs`, `tests/renderer/selection-actions.test.cjs`, `tests/markdown-library.test.cjs`, `tests/library-store.test.cjs`.

**Interfaces:**

- `normalizeEntryMetadata(entry) -> entry` validates bounded `note`, `tags`, `title`, `domain` without touching `text`.
- `extractLinkMetadata(text) -> { title: null, domain: string|null, url: string|null }` is local-only and never fetches URLs.
- `applyBulkMetadata(state, selectedIds, patch) -> { nextState, transaction }` updates selected metadata atomically.

- [ ] **Step 1:** Write failing round-trip tests for notes, tags, URL/title/domain metadata, legacy entries, and bulk metadata undo.
- [ ] **Step 2:** Implement bounded metadata normalization and URL parsing using the standard URL class, rejecting non-http(s) for domain extraction.
- [ ] **Step 3:** Add metadata to Markdown entry comments/frontmatter-compatible structure while preserving user text fences byte-for-byte.
- [ ] **Step 4:** Add inspector edit/read-only display for note/title/domain; the compact card continues to show one text preview line only.
- [ ] **Step 5:** Extend bulk actions with add/remove tag, set note, and set collection references as one undoable transaction.
- [ ] **Step 6:** Run focused tests and full `npm.cmd test`.

**Acceptance:** Notes/tags and link metadata survive restart and batch operations; no metadata action changes clipboard text or duplicates entries.

### Task 3: Search parser, Arabic normalization, filters, highlighting, and ranking

**Files:**

- Create: `search-query.cjs`, `search-index.cjs`.
- Modify: `library-filter.cjs`, `src/renderer/app-state.js`, `src/renderer/render-library.js`, `src/renderer/app.js`, `src/renderer/settings.js`.
- Test: `tests/search-query.test.cjs`, `tests/search-index.test.cjs`, `tests/library-filter.test.cjs`, `tests/renderer/renderer-contract.test.cjs`.

**Interfaces:**

- `parseSearchQuery(input, options) -> { ast, error: null|string }` supports terms, quoted phrases, `AND`, `OR`, `NOT`, and bounded `/regex/`.
- `normalizeArabicSearch(value) -> string` removes search-only diacritics/bidi controls and normalizes compatible alef/ya forms.
- `evaluateSearch(entry, query, context) -> { matched, score, ranges }` returns safe source ranges for highlight.
- `filterLibraryEntries(entries, options) -> SearchResult[]` remains backward-compatible with current `{ query, type, tag }` callers.

- [ ] **Step 1:** Write failing tests for exact/prefix/phrase, AND/OR/NOT precedence, invalid regex, type/source/date/domain filters, Arabic variants, ranges, and deterministic ties.
- [ ] **Step 2:** Run the focused tests to confirm the new parser/index contracts fail before implementation.
- [ ] **Step 3:** Implement a tokenizer/parser with a maximum query length and regex length; return an error object instead of throwing from UI search.
- [ ] **Step 4:** Implement Arabic-only search normalization; retain original entry text and preserve Arabic-Indic/Latin digits in output.
- [ ] **Step 5:** Build an in-memory index over text, OCR text, tags, source, title, domain, and dates; refresh it through explicit calls.
- [ ] **Step 6:** Add filters and deterministic score weights: exact phrase, prefix, field match, recency, then stable original order.
- [ ] **Step 7:** Generate highlight ranges and render escaped text nodes/`<mark>` elements; never assign clipboard text to `innerHTML`.
- [ ] **Step 8:** Debounce search updates and use incremental keyed rendering, preserving scroll/focus/selection.
- [ ] **Step 9:** Run focused and full tests, then inspect a 150-item fixture for latency and DOM churn.

**Acceptance:** Search supports all requested operators/filters and Arabic variants, shows safe highlights, returns deterministic ranked results, and never executes user input.

### Task 4: OCR language detection, QR/barcode detection, and color analysis

**Files:**

- Create: `ocr-language.cjs`, `qr-detector.cjs`, `color-analysis.cjs`.
- Modify: `ocr-text.cjs`, `ocr-engine.cjs`, `src/main/ocr/ocr-service.cjs`, `src/main/ocr/ocr-index.cjs`, `color-picker.cjs`, `src/renderer/color-picker.js`, `src/renderer/inspector.js`.
- Test: `tests/ocr-language.test.cjs`, `tests/qr-detector.test.cjs`, `tests/color-analysis.test.cjs`, `tests/ocr-pipeline.test.cjs`, `tests/color-picker.test.cjs`.

**Interfaces:**

- `detectOcrLanguage(text) -> "ar"|"en"|"mixed"|"unknown"` uses local Unicode/script signals and never changes text.
- `detectCodes(imageBytes, options) -> { qr: [], barcodes: [], links: [] }` returns validated payloads and confidence/status.
- `analyzeImageColors(imageBytes, options) -> { dominant, palette, formats }` returns normalized HEX/RGB/HSL values without rewriting bytes.

- [ ] **Step 1:** Add fixtures for Arabic/English/mixed text, Arabic-Indic/Latin digits, punctuation, one-pixel/flat-color PNG, and code-detector unavailable status.
- [ ] **Step 2:** Write failing tests for language classification, code payload validation, protected/empty images, dominant color and palette bounds.
- [ ] **Step 3:** Implement the Unicode heuristic and preserve the existing OCR line ordering/RTL/punctuation normalizers.
- [ ] **Step 4:** Implement code detection behind a capability adapter; if no bundled detector is available, return `{ status: "unsupported", qr: [], barcodes: [], links: [] }` honestly and keep OCR/color working.
- [ ] **Step 5:** Implement PNG pixel sampling and RGB→HEX/HSL palette analysis with a bounded sample count.
- [ ] **Step 6:** Expose results as inspector/derived metadata and one-click copy values; never add network URL resolution.
- [ ] **Step 7:** Run OCR/color/code focused tests and full `npm.cmd test`.

**Acceptance:** OCR reports language instead of assuming Arabic+English, Arabic digits and punctuation stay correct, code extraction is safe/optional, and color results copy exactly.

### Task 5: Derived text transforms and paste/drag outputs

**Files:**

- Modify: `src/main/transform-service.cjs`, `clipboard-batch.cjs`, `src/renderer/settings.js`, `src/renderer/app.js`, `src/renderer/inspector.js`.
- Create: `text-transforms.cjs`.
- Test: `tests/text-transforms.test.cjs`, `tests/transform-service.test.cjs`, `tests/clipboard-batch.test.cjs`.

**Interfaces:**

- `transformText(text, operation, options) -> { text, operation, sourceLength }` supports whitespace cleanup, case, quotes, and list conversion.
- `transformPreview(text, operation, options) -> { before, after, changed }` is read-only and bounded.
- `toClipboard(item, mode)` keeps current modes and adds explicit derived transform mode without mutating item.

- [ ] **Step 1:** Write failing tests for CRLF/LF, repeated spaces, indentation, Arabic/English case limits, smart quotes, bullets/numbered lists, and empty input.
- [ ] **Step 2:** Implement line-aware transforms with no automatic transformation during capture; transformations run only by user action.
- [ ] **Step 3:** Ensure all output modes preserve the source item and reject unsupported content types explicitly.
- [ ] **Step 4:** Add a compact Tools action/inspector preview and copy transformed output; do not add permanent buttons to the sticky-note toolbar.
- [ ] **Step 5:** Run focused/full tests and verify text remains byte-equivalent after an ordinary save/reload.

**Acceptance:** Users can clean/convert a copy, review before applying, and paste/drag the derived output while the original remains unchanged.

### Task 6: Markdown frontmatter, per-collection files, and portable attachments

**Files:**

- Modify: `markdown-library.cjs`, `library-store.cjs`, `src/main/storage/media-store.cjs`, `src/main/storage/backup-store.cjs`, `src/shared/validation.cjs`.
- Create: `markdown-frontmatter.cjs`, `attachment-paths.cjs`.
- Test: `tests/markdown-frontmatter.test.cjs`, `tests/attachment-paths.test.cjs`, `tests/markdown-library.test.cjs`, `tests/backup-integrity.test.cjs`.

**Interfaces:**

- `serializeFrontmatter(metadata) -> string` and `parseFrontmatter(markdown) -> { metadata, body }` support a fixed typed key allow-list.
- `resolveAttachmentReference(root, relativePath) -> absolutePath` rejects traversal/absolute paths and remains inside root.
- `serializeCollectionFile(collection, root) -> { path, contents }` creates deterministic per-collection Markdown while preserving existing group files.

- [ ] **Step 1:** Write failing tests for frontmatter round-trip, unknown keys, malformed values, old marker-only Markdown, relative media paths, and traversal attempts.
- [ ] **Step 2:** Implement the fixed frontmatter parser/serializer without adding a YAML dependency; unknown keys are preserved only when safe or ignored with diagnostics.
- [ ] **Step 3:** Add versioned frontmatter before existing markers and make parser accept both formats.
- [ ] **Step 4:** Change image Markdown references to relative attachment paths only for new/portable serialization; legacy blob keys continue to load and migrate.
- [ ] **Step 5:** Extend backup manifest to declare attachment files and verify every referenced byte/hash before restore.
- [ ] **Step 6:** Keep one deterministic `.md` file per collection and quarantine only the broken file on parse failure.
- [ ] **Step 7:** Run round-trip, backup, and full tests; inspect generated Markdown manually for human readability.

**Acceptance:** New and old Markdown load, frontmatter is stable, attachments are portable and traversal-safe, and one bad collection file cannot hide the rest.

### Task 7: Version History facade and background OCR/search indexing

**Files:**

- Create: `version-history.cjs`, `background-index-queue.cjs`.
- Modify: `src/main/storage/transaction-store.cjs`, `src/main/ocr/ocr-index.cjs`, `src/main/ipc/register-ipc.cjs`, `preload.cjs`, `src/shared/contracts.cjs`, `main.cjs`, `src/renderer/settings.js`, `src/renderer/app.js`.
- Test: `tests/version-history.test.cjs`, `tests/background-index-queue.test.cjs`, `tests/ocr-index.test.cjs`, `tests/ipc-bridge-contract.test.cjs`, `tests/app-health.test.cjs`.

**Interfaces:**

- `VersionHistory.list() -> GenerationSummary[]`, `inspect(id) -> ReadonlySnapshot`, `restore(id) -> RestoreResult` use TransactionStore validation and atomic promotion.
- `BackgroundIndexQueue.enqueue(key, work) -> Promise<void>`, `flush() -> Promise<void>`, `close() -> Promise<void>` bounds concurrency and preserves last-write-wins ordering.

- [ ] **Step 1:** Write failing tests for generation listing, missing/corrupt generation, read-only inspect, atomic restore, queue coalescing, error recovery, and close flush.
- [ ] **Step 2:** Implement the history facade over existing generation directories; do not expose plaintext in summaries or diagnostics.
- [ ] **Step 3:** Implement a bounded queue using microtask/setImmediate scheduling and per-key coalescing; one failure does not discard later entries.
- [ ] **Step 4:** Route OCR index writes/rebuild through the queue and preserve synchronous API compatibility for existing tests/callers.
- [ ] **Step 5:** Add read-only history UI behind settings/tools and a rebuild-index action with progress/status.
- [ ] **Step 6:** Wire IPC validation and app-health counters; flush on `before-quit` before tearing down services.
- [ ] **Step 7:** Run focused/full tests and a clean-profile restart smoke.

**Acceptance:** history can inspect/restore safely, OCR/search indexing does not block the main flow, queue errors are visible and recoverable, and shutdown does not lose the last queued index update.

### Task 8: Integration, audit, packaging, and PR

**Files:**

- Modify only integration files still needed after Tasks 1–7: `clipboard-shelf.html`, `main.cjs`, `preload.cjs`, `package.json`, and affected renderer modules.
- Test: all existing tests, new focused tests, `tests/syntax-check.cjs`, manifest/ASAR checks, and clean-profile smoke.
- Docs: update the local spec/plan status and add a concise release note if the existing release docs require it.

**Interfaces:** Consumes every task’s public function/IPC contract; produces one integrated branch and a PR reviewable from a clean commit.

- [ ] **Step 1:** Add integration contracts for toolbar/drawer/inspector actions, RTL/English labels, compact density, and no duplicate status-only controls.
- [ ] **Step 2:** Run the full test command and syntax check from a fresh process; do not accept agent-reported gates.
- [ ] **Step 3:** Run `npm.cmd audit --omit=dev --audit-level=high`, manifest verification, and existing ASAR/package tests.
- [ ] **Step 4:** Build portable only if the source tree can be packaged without including user-data/runtime audit directories; verify artifact contents and startup with an isolated profile.
- [ ] **Step 5:** Run clean-code guard on the complete production diff and test guard on changed tests; fix actionable findings and rerun the gates.
- [ ] **Step 6:** Review every changed/untracked file, ensure no user data or temporary screenshots enter the commit, and create a commit containing only the implementation/docs intended for this PR.
- [ ] **Step 7:** Add `https://github.com/martgain/Clipboard` as `origin` only if absent, push the branch, create a PR, and run debate-review on the PR URL.
- [ ] **Step 8:** Resolve only review findings that are supported by the spec and fresh tests; rerun full verification and report exact PR URL/status.

**Acceptance:** all selected new/development features have tests and UI/runtime wiring, status-only features remain unchanged, data round-trips, and the PR contains no unrelated runtime artifacts.

## Feature-to-task map

| IDs | Task |
|---|---|
| 1, 5, 10, 14, 21, 24, 30, 42, 46, 47, 82, 88, 91, 92, 95 | Task 0 verification only |
| 25, 26, 27 | Task 1 |
| 28, 30, 37 | Task 2 |
| 33, 34, 35, 36, 37, 39, 40 | Task 3 (37 metadata input from Task 2) |
| 42, 43, 46, 47, 49, 50 | Task 4 (existing OCR behavior remains) |
| 51, 55 | Task 5 |
| 81, 82, 83 | Task 6 |
| 87, 97 | Task 7 |
| all | Task 8 |

## Rollback

- Before the first feature commit, copy user Markdown/media/backups to an external recovery path and record hashes; do not include that copy in Git.
- Each task is independently revertible; Markdown parser changes keep the legacy read path until two clean profile round-trips pass.
- If an integration gate fails, preserve the failing artifact/log, revert only the task commit or use the previous generation pointer, and never delete current user data to make a test pass.

