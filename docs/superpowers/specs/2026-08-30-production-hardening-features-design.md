# Clipboard Shelf Production Hardening and Feature Expansion

## Goal

Make Clipboard Shelf safe to distribute to other Windows users while keeping every user's library local and independent, then add the highest-value workflow features without introducing a server or account system.

## Current baseline

- Electron desktop app with a compact frameless window, Arabic RTL UI, text/image clipboard capture, pins, normal items, link groups, multi-select, and Backup/Restore.
- Main-process storage already uses `library.json` plus a media directory under Electron's user data path.
- Renderer security boundary already uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, trusted IPC sender checks, and validated HTTP(S) link launching.
- Distribution currently produces an x64 Portable executable; a normal Windows installer and release metadata are missing.

## Decisions

1. Keep the application local-only; no server, login, telemetry, or cloud synchronization.
2. Keep JSON plus sidecar media for this release, but add versioned migrations, atomic recovery, rotating backups, integrity checks, and bounded media writes.
3. Store application data in a dedicated `Clipboard Shelf` subdirectory under Electron `userData`; migrate the existing direct files once without deleting them until the migration succeeds.
4. Keep the existing 50-item normal limit and unlimited pins unless the user changes it later.
5. Preserve the current minimal UI; search and privacy controls live behind the settings gear, while the tray and global shortcut remain optional desktop conveniences.
6. A password is not invented for backups; exported backups remain user-controlled files, with clear validation and merge/replace behavior.

## Feature set

### Release hardening

1. Per-user data directory migration and a visible storage location in settings.
2. Single-instance lock that focuses the existing window when the executable is opened again.
3. Versioned automatic backups with retention and restore validation.
4. Schema migrations and crash recovery for malformed or interrupted state.
5. Media limits, content-hash deduplication, integrity checks, and orphan cleanup.
6. Windows installer target alongside Portable, with stable app identity and installer metadata.

### Workflow features

7. Instant search and type/list filters across text, image, pins, and link groups.
8. Lightweight tags on entries with tag filtering and persistence.
9. Privacy mode: pause capture, optional retention cleanup, and a clear status indicator.
10. Tray behavior and a global shortcut for show/hide; shortcut registration must fail safely without disabling the app.

## Data contracts

`library.json` remains schema version 2 for backward compatibility during this release. New optional fields:

```json
{
  "settings": {
    "searchQuery": "",
    "privacyMode": false,
    "retentionDays": 0
  },
  "normal": [{ "tags": ["work"] }],
  "pinned": [{ "tags": ["important"] }]
}
```

The store must normalize absent fields and reject malformed values. `retentionDays: 0` means no automatic age deletion. Tags are trimmed, deduplicated, limited to 30 characters each, and limited to 20 tags per entry.

## Backend behavior

- Writes use a temporary file followed by rename; failures leave the previous valid state intact.
- Before a periodic save replacement, the previous valid file is copied into a dated backup directory; only the newest five backups are retained.
- Unsupported schema versions are preserved as recovery files and loaded as defaults; supported older versions migrate in memory and are saved in the current schema.
- Image writes reject non-image data, malformed data URLs, and payloads over 12 MiB. Media cleanup removes only files not referenced by the validated library.
- All main-process IPC handlers validate the renderer sender and payload boundaries.
- No remote page is loaded by the app renderer; Chrome opening is the only external navigation path.

## Distribution behavior

- Portable x64 remains available.
- Add an NSIS per-user installer target; it must not require administrator elevation for a normal install.
- The installer and Portable artifact share the same `appId` and product name.
- Code signing is a release-environment requirement, not something claimed locally without a certificate.

## Acceptance criteria

- Two Windows users can install/run the app and cannot see each other's local library files.
- Reopening the executable does not create a second visible window.
- A corrupted or interrupted library file recovers without deleting the previous backup.
- Automatic backups are bounded to five files and restore only validated libraries.
- Oversized or malformed images are rejected; unreferenced media can be removed safely.
- Search, tags, privacy mode, and shortcuts do not break existing capture, drag/drop, pins, groups, Backup/Restore, or the 50-item normal limit.
- `npm test`, a packaged asar inspection, a clean-install smoke test, and a real text/image clipboard smoke test pass before delivery.
