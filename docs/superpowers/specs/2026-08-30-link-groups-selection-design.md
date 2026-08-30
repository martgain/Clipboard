# Clipboard Shelf: Link Groups, Multi-Select, and Batch Clipboard Design

## Goal

Extend the existing local Electron clipboard shelf with a hidden-on-demand link menu, Ctrl/Shift multi-selection, delimiter-based batch clipboard splitting, and durable local storage without changing the compact sticky-note experience.

## Scope

Included:

- Saved link groups with add, rename, edit, reorder, delete, and open-all behavior.
- Opening a group in a new Chrome window with one URL per tab.
- Ctrl/Cmd toggle selection and Shift range selection across pinned and normal cards.
- Creating a link group from selected URL cards.
- A configurable batch separator for splitting one copied text payload into multiple cards.
- Automatic clipboard capture while the desktop app is running, including batch splitting.
- A local main-process storage layer for entries, images, settings, and link groups.
- Versioned migration from the current renderer storage and backup/import support.

Excluded:

- Cloud sync, accounts, remote APIs, a localhost server, background monitoring after the app closes, Windows startup, tray behavior, and global hotkeys that steal shortcuts from other applications.
- Multiple simultaneous operating-system clipboard slots; Windows exposes one current clipboard payload.

## Recommended Architecture

Keep `clipboard-shelf.html` as the renderer and add two small, testable Node modules:

- `clipboard-batch.cjs` contains the separator parser and batch joiner.
- `library-store.cjs` owns the local JSON database and image files with atomic writes and schema migration.

`main.cjs` remains the Electron boundary. It owns the store instance, native clipboard polling, Chrome launching, and typed IPC handlers. `preload.cjs` exposes only the required library, media, link-launch, clipboard, and window methods. The renderer keeps a browser-only fallback using its existing localStorage/IndexedDB path so the HTML remains independently openable.

The desktop store lives under Electron `app.getPath("userData")`:

- `library.json` contains metadata and settings.
- `media/` contains image files addressed by opaque media keys.
- Writes use a temporary file followed by rename, so a closed app cannot leave a half-written JSON file as the active database.

## Data Model

The desktop library is versioned separately from the existing window-preferences file:

```json
{
  "schemaVersion": 2,
  "settings": {
    "theme": "light",
    "duplicatePolicy": "dedupe-move-to-top",
    "normalLimit": 50,
    "autoCapture": true,
    "batchSeparator": "<<<CLIPBOARD-ITEM>>>"
  },
  "pinned": [],
  "normal": [],
  "linkGroups": []
}
```

Each link group has `{ id, name, links, createdAt, updatedAt }`. Links are stored as the user entered them after removing only surrounding whitespace for validation and duplicate comparison. Each saved link must parse as an `http:` or `https:` URL.

Existing text entries retain their exact `text`. Existing image entries retain metadata and use their existing `blobKey` as the migration key; the desktop store copies image bytes into `media/` and the renderer reads them through the media bridge. Browser-only mode continues using IndexedDB.

## Link Menu Behavior

The top bar receives one compact menu icon. It opens a left-side overlay drawer without changing the 355×611 window size. The drawer is closed by default and contains only saved groups and a compact “manage” action.

- Clicking a group opens all its links.
- The open operation detects installed Chrome in the standard Windows locations and launches `chrome.exe --new-window <url1> <url2> ...`, producing one new Chrome window with one tab per URL.
- If Chrome is unavailable, the user receives a clear message and may use the default browser fallback one URL at a time.
- Group management is available from the drawer and the gear settings dialog; it is not rendered as permanent form fields.
- Duplicate links inside a group are ignored while preserving their first position.
- Mixed selections save valid URL cards and report how many non-URL cards were skipped.

## Selection Behavior

Selection state is transient and is not saved:

- Ctrl/Cmd-click toggles one card without disturbing other selected cards.
- Shift-click selects the inclusive range between the anchor card and the clicked card in the visible order.
- A plain click selects only that card and becomes the new anchor.
- Card controls such as copy, pin, delete, and read-more do not accidentally change selection.
- A contextual toolbar appears only while one or more cards are selected. It provides “حفظ كقائمة”, “نسخ كدفعة”, and “إلغاء”.

## Batch Clipboard Behavior

The default separator is the ASCII marker `<<<CLIPBOARD-ITEM>>>`. It is recognized only when it occupies a complete line, allowing normal text that merely contains similar characters to remain intact.

- Text before, between, and after separator lines becomes a separate item.
- The separator line itself is removed; all other text, line endings, spaces, and symbols inside each item remain unchanged.
- Empty segments are ignored because empty clipboard entries are not useful shelf items.
- The separator can be changed in settings and is included in backups.
- Automatic capture and manual Ctrl+V use the same parser.
- “نسخ كدفعة” joins selected text cards with the configured separator and writes one OS clipboard payload; it does not pretend that Windows has multiple simultaneous clipboard slots.

## Persistence and Migration

On first desktop launch after this feature:

1. Load the main-process library if it exists.
2. If it does not exist, read the current renderer state and image blobs, write them to the desktop store, and keep the renderer data until migration succeeds.
3. Store a migration marker only after metadata and every referenced image has been written successfully.
4. On later launches, the main-process library is authoritative in Electron mode.

Import accepts the existing backup shape plus optional `linkGroups` and `batchSeparator`. Imported data is validated, merged with duplicate prevention and the normal 50-item cap, and written atomically. A failed import leaves the current library unchanged.

## Error Handling and Security

- Invalid URLs are rejected with a short Arabic toast and are never sent to Chrome.
- Malformed library files are moved aside with a timestamped recovery name and the app starts from a safe empty state; the user is told that recovery is needed.
- Failed image reads or writes leave the entry metadata unchanged.
- IPC handlers reject non-boolean, non-string, malformed URL, and untrusted-renderer inputs.
- No renderer Node access, arbitrary filesystem path, arbitrary shell command, runtime network request, or unsafe HTML insertion is introduced.

## Acceptance Criteria

1. Existing cards, pins, images, theme, automatic capture, backup/import, undo, and the compact window continue to work.
2. Ctrl/Cmd and Shift selection behave correctly for non-contiguous and contiguous ranges.
3. Selected URL cards can be saved as a named editable group, and the group survives restart and backup/import.
4. Opening a group launches Chrome with one tab per valid URL, with a clear fallback if Chrome is unavailable.
5. Pasting or automatically capturing a marked batch creates one card per non-empty segment while preserving segment content.
6. The local backend persists all library data without requiring a server or internet connection.
7. `npm run check` covers parser, selection, store migration, IPC contracts, and renderer syntax.
8. A real Windows smoke test verifies text, image, automatic capture, selection, group opening, restart persistence, backup/import, and portable packaging.
