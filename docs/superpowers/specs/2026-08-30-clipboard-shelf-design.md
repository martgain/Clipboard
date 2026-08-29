# Clipboard Shelf Design Specification

**Date:** 2026-08-30  
**Status:** Design approved in conversation; awaiting written-spec review before implementation planning.

## Goal

Build a single self-contained static HTML file that acts as a local clipboard shelf: the user can paste or drag plain text into it, keep the text exactly as received, drag or copy the complete text back out, and organize entries into a normal list and a protected Pins list.

## Scope

### In scope

- One directly-openable HTML file containing the application markup, styles, and JavaScript.
- Plain-text clipboard entries, preserving line breaks, spaces, symbols, emoji, and URL text.
- Adding entries by paste and by dragging text into the application.
- Dragging an entry out as complete `text/plain` content while leaving the stored entry unchanged.
- One-click copying of the complete entry text.
- Two lists: Pins at the top and normal entries below.
- Moving an entry into Pins and returning it to the normal list when unpinned.
- Duplicate prevention with an option to change duplicate policy in settings.
- Normal-list capacity fixed at 50 entries; oldest normal entries are removed automatically when the limit is exceeded.
- Unlimited Pins that are removed only through explicit individual deletion.
- Clear-all-normal action protected by confirmation and followed by a temporary undo action.
- Local browser persistence using `localStorage`.
- JSON export and import for moving data between browsers or devices.
- Import merge with duplicate prevention, Pin precedence, and the 50-entry normal-list cap.
- Light and dark display modes.
- No network requests, server, login, or cloud synchronization.

### Out of scope

- Automatic monitoring of operating-system clipboard history.
- Automatic capture of every `Ctrl+C` performed outside the HTML page.
- Rich text, HTML formatting, images, files, or binary clipboard content.
- Browser Extension APIs, Chrome native Side Panel integration, or a desktop tray application.
- Editing saved entries after they are stored.
- Search, keyboard-shortcut customization, tags, analytics, or accounts in the first version.

## User experience

The page opens as a compact RTL Arabic utility suitable for a pinned browser tab or a browser window positioned beside other work. The header contains the application name, normal/Pin counts, light/dark mode toggle, and export/import controls.

Below the header is a prominent paste/drop area. Pasting text or dropping text into the area creates an entry immediately. A manual add action is available for text entered into the area without a paste or drop event. The input is a plain-text control so whitespace and line breaks remain visible and unmodified.

Pins appear in their own section above the normal list. Every entry card displays the complete stored text in a whitespace-preserving view and exposes these actions:

- Copy complete text.
- Pin, or unpin when already pinned.
- Delete the individual entry.
- Drag the card to another compatible input or editor.

Dragging is non-destructive: the receiving target gets the complete plain-text value and the source card remains in its list. If a receiving site blocks browser drops, the Copy action remains available.

The normal section includes a clear-all action. It requires confirmation, clears only normal entries, and shows an undo affordance for a short period. Undo restores exactly the normal entries removed by that clear action. Individual deletion uses the same temporary undo pattern where practical. Pin deletion remains explicit and individual; clearing normal entries never affects Pins.

## Duplicate and ordering rules

Duplicate detection compares the exact stored plain-text value, including line breaks and whitespace.

- A newly added text that is already normal is not duplicated; the existing normal entry moves to the top.
- A newly added text that is already pinned is not duplicated; the existing Pin moves to the top of the Pin list.
- Pinning moves the entry from normal to Pins.
- Unpinning moves the entry from Pins to the top of normal entries.
- Pins are never counted toward the normal 50-entry cap.
- If imported data contains the same text in both groups, the Pin version wins and only one entry remains.
- When the normal list exceeds 50 after insertion, merge, or unpinning, remove the oldest normal entries until exactly 50 remain.

The duplicate-policy setting is represented in the stored settings schema for compatibility, but the first version uses the approved policy: prevent duplicates and move an existing entry to the top. The interface may expose this as a visible fixed policy or a disabled future-setting placeholder only if doing so does not suggest unsupported behavior; it must not offer a control that behaves differently from the approved policy.

## Data model

The application stores one JSON object under a versioned `localStorage` key. The logical shape is:

```json
{
  "schemaVersion": 1,
  "settings": {
    "theme": "light",
    "duplicatePolicy": "dedupe-move-to-top",
    "normalLimit": 50
  },
  "pinned": [
    {
      "id": "stable-local-id",
      "text": "https://example.com",
      "createdAt": 0,
      "updatedAt": 0
    }
  ],
  "normal": []
}
```

IDs are local-only identifiers used for rendering and undo bookkeeping. Text equality, not ID equality, controls duplicate prevention. `createdAt` is retained for provenance, and `updatedAt` changes when an existing entry is moved to the top or changes list.

The application must render stored values as text, never assign them to `innerHTML`, and must not evaluate imported content as markup or code.

## Persistence and backup

Every successful list or settings mutation is persisted to `localStorage`. Reloading the file in the same browser profile restores the data. Different browsers or devices do not share this storage automatically.

Export downloads a JSON backup containing the schema version, settings, Pins, and normal entries. Import accepts only a valid JSON backup with the expected structure. Import is merge-based:

1. Validate and normalize the complete file before changing current data.
2. Merge Pins first and deduplicate by exact text.
3. Merge normal entries that are not already Pins or normal duplicates.
4. Give Pin membership precedence over normal membership.
5. Apply the 50-entry normal limit by retaining the newest normal entries.
6. Save the merged state atomically and report a concise success summary.

Invalid files, unsupported schema versions, malformed entries, or storage failures must leave the current state unchanged and show an actionable Arabic error message. Export failures must also be reported without clearing any data.

## Clipboard and drag-and-drop behavior

The copy action first attempts the modern Clipboard API and falls back to a temporary plain-text textarea method when the browser does not permit the modern API for a local file. Success and failure are visible through a short status message.

For drag-out, the card sets `dataTransfer` `text/plain` to the complete entry value. URL entries use the URL itself as their plain-text payload. For drag-in, the app reads `text/plain` and ignores unsupported rich, file, or image payloads. Empty or whitespace-only drops/pastes are rejected with a short message and do not create an entry.

## Error handling and safety

- The application never sends stored content over the network.
- All user content is treated as untrusted text and rendered safely.
- Local-storage quota failures preserve the in-memory state and explain that the browser storage limit was reached.
- Import is transactional from the user’s perspective: failed validation cannot partially modify the current lists.
- Clear and individual delete actions have confirmation/undo feedback appropriate to their risk.
- The page remains usable if Clipboard API permissions are unavailable; drag and import/export still work where supported.

## Acceptance criteria

The implementation is accepted when all of the following are demonstrably true in a current Chrome browser opened from the local HTML file:

1. A multiline string with spaces, symbols, emoji, and a URL can be pasted and is displayed exactly.
2. Dragging the saved card into a compatible text field inserts the complete text without selecting a substring.
3. Clicking Copy places the complete text on the system clipboard, and the source card remains present.
4. Dragging plain text from a page into the drop area creates a new entry.
5. Adding an identical value does not create a duplicate and moves the existing entry to the top.
6. Pinning moves an entry to Pins; unpinning returns it to the normal list.
7. Adding more than 50 normal entries removes only the oldest normal entries; Pins remain untouched.
8. Clear-all normal requires confirmation, leaves Pins intact, and undo restores the cleared normal entries.
9. A Pin can be deleted individually and does not disappear during normal-list cleanup.
10. Reloading restores lists and theme in the same browser profile.
11. Export produces a readable JSON backup; importing it into a populated page merges data without duplicates and applies the normal cap.
12. Light/dark mode changes the display and persists after reload.
13. Invalid import data produces an error without changing existing content.
14. The HTML file has no external runtime dependency or network request.

## Verification approach

Verification will combine source inspection and a browser smoke test. The smoke test will exercise paste, external drag-in, internal drag-out, copy, duplicate movement, pin/unpin, 51-entry retention, clear/undo, individual Pin deletion, reload persistence, theme persistence, export/import merge, and invalid-import rollback. The final review will also inspect that all user text is rendered as text and that no external assets or requests were introduced.
