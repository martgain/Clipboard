# Clipboard Shelf Production Hardening and Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden local persistence and Windows distribution, then add search, tags, privacy controls, and safe desktop shortcuts to Clipboard Shelf.

**Architecture:** Keep privileged filesystem, backup, media, tray, and shortcut work in Electron's main process behind narrow preload methods. Keep renderer state as the single UI model, normalize every loaded payload, and add pure CommonJS modules for storage policy, retention, and filtering so behavior is testable without a window.

**Tech Stack:** Electron 37, Electron Builder 26, CommonJS main/preload modules, single-file HTML/CSS/JS renderer, Node test runner, Windows x64 Portable and NSIS targets.

**Spec:** `docs/superpowers/specs/2026-08-30-production-hardening-features-design.md`

## Global Constraints

- Local-only: no server, login, telemetry, or cloud synchronization.
- Preserve the compact frameless RTL UI and current clipboard behavior.
- Keep `normalLimit` at 50 and pins unlimited.
- Keep JSON plus sidecar media, with atomic writes and validated IPC.
- Store app data in a dedicated subdirectory under Electron `userData` and migrate existing data safely.
- Reject image payloads over 12 MiB and retain at most five automatic backups.
- `retentionDays: 0` disables automatic age deletion.
- Run tests and packaged/runtime smoke checks before claiming completion.

---

### Task 1: Harden storage paths, migrations, backups, and media policy

**Files:**
- Modify: `library-store.cjs`
- Modify: `main.cjs`
- Modify: `preload.cjs`
- Test: `tests/library-store.test.cjs`
- Create: `backup-policy.cjs`
- Test: `tests/backup-policy.test.cjs`

**Interfaces:**
- `createLibraryStore({ dataFile, legacyDataFile, mediaDirectory, backupDirectory, maxImageBytes, backupRetention })` migrates the legacy file, validates state, writes atomically, and exposes `listBackups()`, `restoreBackup(name)`, and `cleanupMedia(library)`.
- `createBackupPlan(names, retention)` returns the newest retained backup names in deterministic order.
- Preload exposes `listLibraryBackups`, `restoreLibraryBackup`, and `cleanupLibraryMedia`.

- [ ] Write failing tests for legacy schema migration, periodic backup retention, invalid restore names, 12 MiB image rejection, and orphan cleanup.
- [ ] Run `node --test tests/library-store.test.cjs tests/backup-policy.test.cjs` and confirm the new tests fail for missing behavior.
- [ ] Implement validated path resolution, schema-1-to-2 migration, backup rotation, bounded image writes, and reference-based cleanup.
- [ ] Add main-process IPC handlers with sender checks and renderer error responses.
- [ ] Run the focused tests and then `npm test`.

### Task 2: Single instance, tray, and global shortcut

**Files:**
- Modify: `main.cjs`
- Modify: `preload.cjs`
- Modify: `clipboard-shelf.html`
- Modify: `package.json`
- Test: `tests/syntax-check.cjs`

**Interfaces:**
- Main process acquires `app.requestSingleInstanceLock()` before creating windows.
- Preload exposes `toggleWindowVisibility()` only through a validated IPC channel.
- Renderer settings expose `enableGlobalShortcut` and reflect registration failure without crashing.

- [ ] Add contract tests for single-instance setup, tray lifecycle, and shortcut IPC names.
- [ ] Implement second-instance focus, tray menu show/hide, and cleanup on quit.
- [ ] Register a safe default shortcut only when enabled; unregister on quit and settings change.
- [ ] Add a compact settings toggle and a status toast for unavailable shortcuts.
- [ ] Run syntax tests and a real launch/relaunch smoke test.

### Task 3: Search, filters, tags, and privacy retention

**Files:**
- Create: `library-filter.cjs`
- Test: `tests/library-filter.test.cjs`
- Modify: `clipboard-shelf.html`
- Modify: `library-store.cjs`

**Interfaces:**
- `filterLibraryEntries(entries, { query, type, listName, tag })` returns entries in source order without mutating them.
- Renderer settings persist `privacyMode`, `retentionDays`, and tag metadata through the existing library payload.

- [ ] Write failing pure-function tests for Arabic/English case-insensitive search, URL search, type/list/tag filters, and no-match results.
- [ ] Implement the pure filter module and run its focused tests.
- [ ] Add a hidden-by-default search/filter strip opened from settings or the drawer.
- [ ] Add tag edit controls to cards and normalize tags at load/save boundaries.
- [ ] Pause automatic capture in privacy mode and apply retention cleanup only when a positive retention period is configured.
- [ ] Run `npm test` and renderer smoke checks for capture, selection, and search.

### Task 4: Installer and release metadata

**Files:**
- Modify: `package.json`
- Create: `build/icon.ico` (only if a valid project icon is available; otherwise keep the builder default and document it)
- Modify: `tests/syntax-check.cjs`
- Modify: `docs/superpowers/specs/2026-08-30-production-hardening-features-design.md`

**Interfaces:**
- `npm run build:portable` produces the existing x64 Portable artifact.
- `npm run build:installer` produces an x64 NSIS per-user installer with the same app identity.

- [ ] Add package scripts and NSIS configuration without changing the Portable target.
- [ ] Add tests that assert both targets, stable appId, and product name.
- [ ] Build both artifacts and inspect their packaged `app.asar` file lists.
- [ ] Verify a clean install/launch in a disposable Windows profile or isolated install directory.

### Task 5: Final verification and handoff

**Files:**
- Modify: `tests/syntax-check.cjs` only when a discovered contract needs coverage.
- Modify: `docs/superpowers/plans/2026-08-30-production-hardening-features.md` to mark completed steps.

- [ ] Run `npm test` and record the exact test count.
- [ ] Run `git diff --check` and inspect changed production, test, and documentation files.
- [ ] Run clean-code, test, and docs guards against the changed scopes.
- [ ] Run real Windows smoke: text copy, screenshot copy, paste, drag/drop, multi-select, group open, restart persistence, backup recovery, and package launch.
- [ ] Report the Portable and Installer paths, hashes, user-data behavior, test results, and any certificate/signing limitation.
