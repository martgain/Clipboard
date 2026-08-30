# Clipboard Shelf Design Specification

**Date:** 2026-08-30  
**Status:** Design approved in conversation; awaiting written-spec review before implementation planning.

## Goal

Build a single self-contained static HTML file that acts as a local clipboard shelf: the user can paste or drag plain text into it, keep the text exactly as received, drag or copy the complete text back out, and organize entries into a normal list and a protected Pins list.

## Scope

### In scope

- One directly-openable HTML file containing the application markup, styles, and JavaScript.
- Compact sticky-note-style UI with minimal visible copy, controls, and chrome; the page must remain usable when the browser viewport is narrowed to roughly 10% of a desktop width.
- Plain-text clipboard entries, preserving line breaks, spaces, symbols, emoji, and URL text.
- Image clipboard entries accepted by paste and by dragging image files into the application.
- Image entries rendered as tiny thumbnails without enlarging the source image; original image data remains available for copy/drag where browser APIs permit.
- Adding entries by paste and by dragging text or images into the application.
- Dragging a text entry out as complete `text/plain` content or an image entry out as image/file data while leaving the stored entry unchanged.
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
- After a click anywhere on the page, page-local `Ctrl/Cmd+V` adds the current clipboard text or image immediately; page-local `Ctrl/Cmd+C` copies the focused entry’s complete content.
- No network requests, server, login, or cloud synchronization.

### Out of scope

- Automatic monitoring of operating-system clipboard history.
- Automatic capture of every `Ctrl+C` performed outside the HTML page.
- Capturing `Ctrl+C` from another page or application while this file is not active; Static HTML cannot receive that global event.
- Rich text, HTML formatting, arbitrary non-image files, or binary clipboard content unrelated to an image.
- Browser Extension APIs, Chrome native Side Panel integration, or a desktop tray application.
- Editing saved entries after they are stored.
- Search, keyboard-shortcut customization, tags, analytics, or accounts in the first version.

## User experience

The page opens as a very compact RTL Arabic sticky-note utility suitable for a pinned browser tab or a narrow browser window positioned beside other work. The interface should not look like a form-heavy dashboard: the header uses a short title, compact counts, and one gear button. Avoid explanatory paragraphs, repeated visible labels, and large bordered panels. The layout has no fixed minimum width, no horizontal overflow, and remains usable around 10% of a typical desktop width; labels collapse to compact icons/tooltips where necessary.

The entire page surface is the drag-and-drop target; there is no dedicated drop button or drop square. Dropping text or an image anywhere inside the page creates an entry immediately. There is no permanently visible large textarea. Clicking any non-control area activates the page, and page-local `Ctrl/Cmd+V` then reads the clipboard and adds its plain-text or image value immediately when the browser exposes it; this is the primary paste path. A compact fallback action may be shown only when a browser blocks clipboard reading.

The only persistent utility control in the header is a gear button. Activating it opens a compact settings dialog containing the light/dark mode control, JSON export/import controls, the clear-normal action, and concise help about the fixed duplicate/cap behavior. These controls stay hidden until the gear is opened. The dialog closes with an explicit close control, Escape, or clicking outside its surface.

Pins appear in their own section above the normal list. Every text card displays the complete stored text in a whitespace-preserving view, and every card exposes these actions:

- Copy complete text.
- Pin, or unpin when already pinned.
- Delete the individual entry.
- Drag the card to another compatible input or editor.

Cards should read as compact sticky-note rows rather than large dashboard panels. Text cards show one line only by default, with a compact arrow or `اقرأ المزيد` action to expand and collapse the full whitespace-preserving value. Each card displays a visible sequence number beside the content. Image cards use a tiny fixed thumbnail that never enlarges the source image. Secondary explanations and repeated labels are omitted. Card actions use compact icon-like buttons with Arabic accessible labels and tooltips instead of long visible button text. At extremely narrow widths, controls remain reachable and the text wraps within the viewport rather than forcing horizontal scrolling.

When an entry card is focused, page-local `Ctrl/Cmd+C` copies its complete content without requiring a visible Copy button. A small Copy affordance may remain available for mouse users, but the primary interaction is the keyboard shortcut and drag.

Dragging is non-destructive: the receiving target gets the complete plain-text value and the source card remains in its list. If a receiving site blocks browser drops, the Copy action remains available.

The normal section includes a clear-all action. It requires confirmation, clears only normal entries, and shows an undo affordance for a short period. Undo restores exactly the normal entries removed by that clear action. Individual deletion uses the same temporary undo pattern where practical. Pin deletion remains explicit and individual; clearing normal entries never affects Pins.

## Duplicate and ordering rules

Duplicate detection compares the exact stored plain-text value, including line breaks and whitespace, or the image content signature for image entries.

- A newly added text that is already normal is not duplicated; the existing normal entry moves to the top.
- A newly added text that is already pinned is not duplicated; the existing Pin moves to the top of the Pin list.
- Pinning moves the entry from normal to Pins.
- Unpinning moves the entry from Pins to the top of normal entries.
- Pins are never counted toward the normal 50-entry cap.
- If imported data contains the same text in both groups, the Pin version wins and only one entry remains.
- If the same image is imported or added again, the existing image entry moves to the top of its current list; Pin membership wins over normal membership.
- When the normal list exceeds 50 after insertion, merge, or unpinning, remove the oldest normal entries until exactly 50 remain.

The duplicate-policy setting is represented in the stored settings schema for compatibility, but the first version uses the approved policy: prevent duplicates and move an existing entry to the top. The interface may expose this as a visible fixed policy or a disabled future-setting placeholder only if doing so does not suggest unsupported behavior; it must not offer a control that behaves differently from the approved policy.

## Data model

Text metadata and list state are stored under a versioned `localStorage` key. Image blobs are stored locally in a versioned IndexedDB object store keyed by entry ID, so the original image does not need to be inflated into the HTML file. The logical shape is:

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
      "type": "text",
      "text": "https://example.com",
      "createdAt": 0,
      "updatedAt": 0
    },
    {
      "id": "image-local-id",
      "type": "image",
      "image": {
        "blobKey": "image-local-id",
        "mimeType": "image/png",
        "size": 12345,
        "hash": "a1b2c3d4"
      },
      "createdAt": 0,
      "updatedAt": 0
    }
  ],
  "normal": []
}
```

IDs are local-only identifiers used for rendering and undo bookkeeping. Text equality, not ID equality, controls duplicate prevention. `createdAt` is retained for provenance, and `updatedAt` changes when an existing entry is moved to the top or changes list.

The application must render stored text values as text, never assign user content to `innerHTML`, and must not evaluate imported content as markup or code. Image previews use object URLs created from locally stored Blobs and are revoked when replaced or removed.

## Persistence and backup

Every successful list or settings mutation is persisted to `localStorage`; every image add/delete is committed to IndexedDB before its metadata is committed. Reloading the file in the same browser profile restores the data. Different browsers or devices do not share this storage automatically.

Export downloads a JSON backup containing the schema version, settings, Pins, normal entries, and image payloads encoded as base64 data URLs. Import accepts only a valid JSON backup with the expected structure. Import is merge-based:

1. Validate and normalize the complete file before changing current data.
2. Merge Pins first and deduplicate by exact text.
3. Merge normal entries that are not already Pins or normal duplicates.
4. Give Pin membership precedence over normal membership.
5. Apply the 50-entry normal limit by retaining the newest normal entries.
6. Store new image Blobs in IndexedDB, save the merged metadata state atomically, and report a concise success summary.

Invalid files, unsupported schema versions, malformed entries, or storage failures must leave the current state unchanged and show an actionable Arabic error message. Export failures must also be reported without clearing any data.

## Clipboard and drag-and-drop behavior

The copy action first attempts the modern Clipboard API and falls back to a temporary plain-text textarea method when the browser does not permit the modern API for a local file. Success and failure are visible through a short status message.

For drag-out, text cards set `dataTransfer` `text/plain` to the complete entry value, while image cards provide their original image data where the browser supports it. URL entries use the URL itself as their plain-text payload. For drag-in, the app reads `text/plain` plus `image/*` file payloads and ignores unsupported rich or non-image files. Empty or whitespace-only drops/pastes are rejected with a short message and do not create an entry.

## Error handling and safety

- The application never sends stored content over the network.
- All user content is treated as untrusted text and rendered safely.
- Local-storage quota failures preserve the in-memory state and explain that the browser storage limit was reached.
- Import is transactional from the user’s perspective: failed validation cannot partially modify the current lists.
- Clear and individual delete actions have confirmation/undo feedback appropriate to their risk.
- The page remains usable if Clipboard API permissions are unavailable; drag and import/export still work where supported.
- If IndexedDB is unavailable or cannot store an image, reject only that image with a concise Arabic error and leave existing content unchanged.

## Acceptance criteria

The implementation is accepted when all of the following are demonstrably true in a current Chrome browser opened from the local HTML file:

1. A multiline string with spaces, symbols, emoji, and a URL can be pasted and is displayed as one preview line with an expand/read-more control.
2. Expanding a text card shows the complete value with its original line structure; collapsing returns to one line.
3. Dragging the saved text card into a compatible text field inserts the complete text without selecting a substring.
4. Copying the focused text card places the complete text on the system clipboard, and the source card remains present.
5. Dragging plain text or an image file from a page/file manager anywhere into the page creates a new entry.
6. Pasting an image from the system clipboard creates an image entry when the browser exposes image clipboard data.
7. Image entries render as tiny thumbnails and can be dragged/copied where the browser supports image data.
8. Adding an identical text or image does not create a duplicate and moves the existing entry to the top.
9. Pinning moves an entry to Pins; unpinning returns it to the normal list.
10. Adding more than 50 normal text/image entries removes only the oldest normal entries; Pins remain untouched.
11. Clear-all normal requires confirmation, leaves Pins intact, and undo restores the cleared normal entries.
12. A Pin can be deleted individually and does not disappear during normal-list cleanup.
13. Reloading restores lists, image previews, sequence numbers, and theme in the same browser profile.
14. Export produces a readable JSON backup including image payloads; importing it into a populated page merges data without duplicates and applies the normal cap.
15. Light/dark mode changes the display and persists after reload.
16. Invalid import data produces an error without changing existing content.
17. The HTML file has no external runtime dependency or network request.
18. Narrowing the viewport to roughly 10% of a desktop width keeps the page usable: no horizontal overflow, the entire page remains a drop surface, the gear dialog fits the viewport, thumbnails stay tiny, and card text wraps without clipping the controls.

## Verification approach

Verification will combine source inspection and a browser smoke test. The smoke test will exercise click-then-paste, external drag-in, internal drag-out, copy, duplicate movement, pin/unpin, 51-entry retention, clear/undo, individual Pin deletion, reload persistence, theme persistence, export/import merge, and invalid-import rollback. The final review will also inspect that all user text is rendered as text and that no external assets or requests were introduced.
