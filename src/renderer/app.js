import { AppStateStore, filterLibraryEntries } from "./app-state.js";
import { renderLibrary } from "./render-library.js";
import { ToolbarController } from "./toolbar.js";
import { wireSettings } from "./settings.js";
import { AccessibilityAnnouncer } from "./accessibility.js";
import { formatColorDetails } from "./color-picker.js";
import { SerializedSaveQueue } from "./save-queue.js";
import { inspectEntry } from "./inspector.js";
import { QuickPalette } from "./quick-palette.js";
import { quickPaletteOptionId, restoreQuickPaletteFocus, syncQuickPaletteAccessibility } from "./quick-palette-accessibility.js";
import { createSmartCollection, evaluateCollection, matchesCollectionQuery } from "./collections.js";
    const STORAGE_KEY = "clipboard-shelf-state-v1";
    const SCHEMA_VERSION = 2;
    const NORMAL_LIMIT = 150;
    const DEFAULT_BATCH_SEPARATOR = "<<<CLIPBOARD-ITEM>>>";
    const DEFAULT_GLOBAL_SHORTCUT = "CommandOrControl+Shift+Space";
    const UNDO_WINDOW_MS = 9000;
    const MAX_IMPORT_BYTES = 32 * 1024 * 1024;
    const IMAGE_DB_NAME = "clipboard-shelf-images-v1";
    const IMAGE_STORE_NAME = "images";
    const LINK_DRAWER_COMPACT_KEY = "clipboard-shelf-link-drawer-compact-v1";
    const TEXT_FEEDBACK = Object.freeze({
      invalid: "لم تتم الإضافة: النص فارغ.",
      duplicate: "النص موجود بالفعل وتم نقله للأعلى.",
      pinned: "تمت الإضافة إلى المثبتة.",
      normal: "تمت الإضافة."
    });
    const IMAGE_FEEDBACK = Object.freeze({
      invalid: "لم تتم الإضافة: ملف غير مدعوم.",
      empty: "لم تتم الإضافة: الصورة فارغة.",
      readError: "تعذر قراءة الصورة.",
      storageError: "تعذر حفظ الصورة: التخزين المحلي (IndexedDB) غير متاح.",
      saveError: "تعذر حفظ الصورة محليًا.",
      duplicate: "الصورة موجودة بالفعل وتم نقلها للأعلى.",
      pinned: "تمت إضافة الصورة إلى المثبتة.",
      normal: "تمت إضافة الصورة."
    });
    const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
    const { GROUP_ICON_CATALOG, DEFAULT_GROUP_ICON, getGroupDisplayModel, normalizeGroupIcon } = window.ClipboardShelfIcons;
    const ICON_DEFINITIONS = Object.freeze({
      ...Object.fromEntries(GROUP_ICON_CATALOG.map((icon) => [icon.name, icon.definition])),
      copy: [
        { name: "path", attributes: { d: "M8 8h9v11H8z" } },
        { name: "path", attributes: { d: "M5 16H4V5h9v1" } }
      ],
      pin: [
        { name: "path", attributes: { d: "m9 4 6 0 1 5 3 3-5 1-2 7-2-7-5-1 3-3 1-5Z" } },
        { name: "path", attributes: { d: "M12 20v-7" } }
      ],
      trash: [
        { name: "path", attributes: { d: "M5 7h14M10 4h4l1 3H9l1-3ZM7 7l1 13h8l1-13M10 11v5M14 11v5" } }
      ],
      tag: [
        { name: "path", attributes: { d: "M4 5v6l9 9 6-6-9-9H4Z" } },
        { name: "circle", attributes: { cx: "8", cy: "9", r: "1" } }
      ],
      pencil: [
        { name: "path", attributes: { d: "m4 16-.7 4.7L8 20l11-11-4-4L4 16Z" } },
        { name: "path", attributes: { d: "m13 6 4 4" } }
      ],
      chevronUp: [
        { name: "path", attributes: { d: "m6 14 6-6 6 6" } }
      ],
      chevronDown: [
        { name: "path", attributes: { d: "m6 10 6 6 6-6" } }
      ],
      panel: [
        { name: "rect", attributes: { x: "3", y: "4", width: "18", height: "16", rx: "2" } },
        { name: "path", attributes: { d: "M8 4v16" } }
      ]
    });

    const elements = {
      app: document.getElementById("app"),
      pinnedList: document.getElementById("pinnedList"),
      normalList: document.getElementById("normalList"),
      pinnedEmpty: document.getElementById("pinnedEmpty"),
      normalEmpty: document.getElementById("normalEmpty"),
      settingsButton: document.getElementById("settingsButton"),
      keyboardLockButton: document.getElementById("keyboardLockButton"),
      colorPickerButton: document.getElementById("colorPickerButton"),
      ocrButton: document.getElementById("ocrButton"),
      toolsMenuButton: document.getElementById("toolsMenuButton"),
      toolsMenu: document.getElementById("toolsMenu"),
      overflowColorPickerButton: document.getElementById("overflowColorPickerButton"),
      overflowOcrButton: document.getElementById("overflowOcrButton"),
      overflowLinkMenuButton: document.getElementById("overflowLinkMenuButton"),
      overflowSearchButton: document.getElementById("overflowSearchButton"),
      overflowTransformButton: document.getElementById("overflowTransformButton"),
      overflowAnalyzeImageButton: document.getElementById("overflowAnalyzeImageButton"),
      settingsDialog: document.getElementById("settingsDialog"),
      themeToggle: document.getElementById("themeToggle"),
      autoCaptureToggle: document.getElementById("autoCaptureToggle"),
      globalShortcutToggle: document.getElementById("globalShortcutToggle"),
      globalShortcutInput: document.getElementById("globalShortcutInput"),
      globalShortcutDefaultButton: document.getElementById("globalShortcutDefaultButton"),
      privacyModeToggle: document.getElementById("privacyModeToggle"),
      retentionDaysInput: document.getElementById("retentionDaysInput"),
      exportButton: document.getElementById("exportButton"),
      importButton: document.getElementById("importButton"),
      restoreLocalBackupButton: document.getElementById("restoreLocalBackupButton"),
      createMarkdownSnapshotButton: document.getElementById("createMarkdownSnapshotButton"),
      verifyMarkdownSnapshotButton: document.getElementById("verifyMarkdownSnapshotButton"),
      reloadMarkdownButton: document.getElementById("reloadMarkdownButton"),
      openMarkdownDirectoryButton: document.getElementById("openMarkdownDirectoryButton"),
      storageHealthButton: document.getElementById("storageHealthButton"),
      appHealthButton: document.getElementById("appHealthButton"),
      listVersionHistoryButton: document.getElementById("listVersionHistoryButton"),
      restoreVersionHistoryButton: document.getElementById("restoreVersionHistoryButton"),
      rebuildOcrIndexButton: document.getElementById("rebuildOcrIndexButton"),
      importInput: document.getElementById("importInput"),
      clearNormalButton: document.getElementById("clearNormalButton"),
      batchSeparatorInput: document.getElementById("batchSeparatorInput"),
      manageLinkGroupsButton: document.getElementById("manageLinkGroupsButton"),
      linkMenuButton: document.getElementById("linkMenuButton"),
      searchToggleButton: document.getElementById("searchToggleButton"),
      searchPanel: document.getElementById("searchPanel"),
      searchInput: document.getElementById("searchInput"),
      searchType: document.getElementById("searchType"),
      searchTag: document.getElementById("searchTag"),
      searchSource: document.getElementById("searchSource"),
      searchDateFrom: document.getElementById("searchDateFrom"),
      searchDateTo: document.getElementById("searchDateTo"),
      linkDrawer: document.getElementById("linkDrawer"),
      drawerBackdrop: document.getElementById("drawerBackdrop"),
      closeLinkDrawerButton: document.getElementById("closeLinkDrawerButton"),
      newSmartCollectionButton: document.getElementById("newSmartCollectionButton"),
      clearActiveCollectionButton: document.getElementById("clearActiveCollectionButton"),
      smartCollectionList: document.getElementById("smartCollectionList"),
      smartCollectionsEmpty: document.getElementById("smartCollectionsEmpty"),
      newLinkGroupButton: document.getElementById("newLinkGroupButton"),
      toggleLinkDrawerSizeButton: document.getElementById("toggleLinkDrawerSizeButton"),
      linkGroupList: document.getElementById("linkGroupList"),
      linkGroupEmpty: document.getElementById("linkGroupEmpty"),
      purgeAllTrashButton: document.getElementById("purgeAllTrashButton"),
      trashList: document.getElementById("trashList"),
      trashEmpty: document.getElementById("trashEmpty"),
      linkGroupDialog: document.getElementById("linkGroupDialog"),
      inspectorDialog: document.getElementById("inspectorDialog"),
      closeInspectorButton: document.getElementById("closeInspectorButton"),
      inspectorPreview: document.getElementById("inspectorPreview"),
      inspectorMetadata: document.getElementById("inspectorMetadata"),
      linkGroupForm: document.getElementById("linkGroupForm"),
      linkGroupNameInput: document.getElementById("linkGroupNameInput"),
      groupIconPicker: document.getElementById("groupIconPicker"),
      linkGroupLinksInput: document.getElementById("linkGroupLinksInput"),
      closeLinkGroupDialogButton: document.getElementById("closeLinkGroupDialogButton"),
      cancelLinkGroupButton: document.getElementById("cancelLinkGroupButton"),
      selectionToolbar: document.getElementById("selectionToolbar"),
      selectionCount: document.getElementById("selectionCount"),
      toggleSelectionPinsButton: document.getElementById("toggleSelectionPinsButton"),
      tagSelectionButton: document.getElementById("tagSelectionButton"),
      deleteSelectionButton: document.getElementById("deleteSelectionButton"),
      saveSelectionButton: document.getElementById("saveSelectionButton"),
      copySelectionButton: document.getElementById("copySelectionButton"),
      clearSelectionButton: document.getElementById("clearSelectionButton"),
      toastRegion: document.getElementById("toastRegion"),
      liveStatus: document.getElementById("liveStatus"),
      pinnedCount: document.getElementById("pinnedCount"),
      normalCount: document.getElementById("normalCount"),
      windowControls: document.getElementById("windowControls"),
      alwaysOnTopButton: document.getElementById("alwaysOnTopButton"),
      minimizeButton: document.getElementById("minimizeButton"),
      closeButton: document.getElementById("closeButton"),
      quickPalette: document.getElementById("quickPalette"),
      quickPaletteInput: document.getElementById("quickPaletteInput"),
      quickPaletteList: document.getElementById("quickPaletteList"),
      quickPaletteEmpty: document.getElementById("quickPaletteEmpty"),
      closeQuickPaletteButton: document.getElementById("closeQuickPaletteButton")
    };

    const desktopApi = window.desktopBridge && typeof window.desktopBridge.readClipboard === "function"
      ? window.desktopBridge
      : null;
    const desktopSaveQueue = new SerializedSaveQueue(
      (library) => desktopApi?.saveLibrary(library) || Promise.resolve(),
      () => showToast("تعذر حفظ المكتبة المحلية.", false)
    );

    const appStateStore = new AppStateStore(createDefaultState());
    const trashStore = new window.ClipboardShelfTrash.TrashStore();
    const accessibilityAnnouncer = new AccessibilityAnnouncer(elements.liveStatus);
    let state = appStateStore.getState();
    let desktopStateLoaded = !desktopApi;
    let selectedCardKeys = new Set();
    let selectionAnchorKey = null;
    let editingLinkGroupId = null;
    let linkDrawerOpen = false;
    let linkDrawerCompact = loadLinkDrawerCompactPreference();
    let selectedGroupIcon = DEFAULT_GROUP_ICON;
    let activeSmartCollectionId = null;
    let searchPanelOpen = false;
    let searchType = "all";
    let searchTag = "";
    let searchSource = "";
    let searchDateFrom = "";
    let searchDateTo = "";
    let searchSaveTimer = null;
    let toolsMenuOpen = false;
    let lastUndo = null;
    let undoTimer = null;
    let toastTimer = null;
    let imageDbPromise = null;
    let activeImageObjectUrls = [];
    let inspectorObjectUrl = null;
    let quickPalette = null;
    let quickPaletteOpen = false;
    let quickPaletteFocusReturn = null;
    const renderedCardCache = {
      pinned: new Map(),
      normal: new Map()
    };

    function createDefaultState() {
      return {
        schemaVersion: SCHEMA_VERSION,
        settings: {
          theme: "light",
          duplicatePolicy: "dedupe-move-to-top",
          normalLimit: NORMAL_LIMIT,
          autoCapture: true,
          batchSeparator: DEFAULT_BATCH_SEPARATOR,
          globalShortcutEnabled: false,
          globalShortcutAccelerator: DEFAULT_GLOBAL_SHORTCUT,
          searchQuery: "",
          privacyMode: false,
          retentionDays: 0
        },
        pinned: [],
        normal: [],
        linkGroups: [],
        smartCollections: [],
        trash: []
      };
    }

    function loadLinkDrawerCompactPreference() {
      try {
        return localStorage.getItem(LINK_DRAWER_COMPACT_KEY) === "true";
      } catch (storageError) {
        return false;
      }
    }

    function saveLinkDrawerCompactPreference() {
      try {
        localStorage.setItem(LINK_DRAWER_COMPACT_KEY, String(linkDrawerCompact));
      } catch (storageError) {
        // The drawer can still be resized for the current session if storage is unavailable.
      }
    }

    function normalizeState(raw) {
      const fallbackState = createDefaultState();

      if (!raw || typeof raw !== "object" || ![1, SCHEMA_VERSION].includes(raw.schemaVersion)) {
        return fallbackState;
      }

      const theme = raw.settings && raw.settings.theme === "dark" ? "dark" : "light";
      const autoCapture = !raw.settings || raw.settings.autoCapture !== false;
      const batchSeparator = validBatchSeparator(raw.settings && raw.settings.batchSeparator)
        ? raw.settings.batchSeparator
        : DEFAULT_BATCH_SEPARATOR;
      const globalShortcutEnabled = raw.settings && raw.settings.globalShortcutEnabled === true;
      const globalShortcutAccelerator = window.ClipboardShelfAccelerator.normalizeGlobalShortcut(raw.settings?.globalShortcutAccelerator)
        || DEFAULT_GLOBAL_SHORTCUT;
      const pinned = normalizeEntries(raw.pinned);
      const pinnedSignatures = new Set(pinned.map((entry) => entrySignature(entry)));
      const normal = normalizeEntries(raw.normal)
        .filter((entry) => !pinnedSignatures.has(entrySignature(entry)))
        .slice(0, NORMAL_LIMIT);

      return {
        schemaVersion: SCHEMA_VERSION,
        settings: {
          theme,
          duplicatePolicy: "dedupe-move-to-top",
          normalLimit: NORMAL_LIMIT,
          autoCapture,
          batchSeparator,
          globalShortcutEnabled,
          globalShortcutAccelerator,
          searchQuery: typeof raw.settings?.searchQuery === "string" ? raw.settings.searchQuery : "",
          privacyMode: raw.settings?.privacyMode === true,
          retentionDays: Number.isInteger(raw.settings?.retentionDays) && raw.settings.retentionDays >= 0
            ? Math.min(raw.settings.retentionDays, 3650)
            : 0
        },
        pinned,
        normal,
        linkGroups: normalizeLinkGroups(raw.linkGroups),
        smartCollections: normalizeSmartCollections(raw.smartCollections),
        trash: Array.isArray(raw.trash) ? [...raw.trash] : []
      };
    }

    function validBatchSeparator(candidate) {
      return typeof candidate === "string" && candidate.length >= 3 && candidate.length <= 80 && !candidate.includes("\n") && !candidate.includes("\r");
    }

    function validGlobalShortcut(candidate) {
      return Boolean(window.ClipboardShelfAccelerator?.normalizeGlobalShortcut(candidate));
    }

    function validLink(candidate) {
      if (typeof candidate !== "string" || candidate.trim().length === 0) {
        return false;
      }

      try {
        const parsed = new URL(candidate.trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:";
      } catch (urlError) {
        return false;
      }
    }

    function removeExpiredEntries(entries, now, retentionDays) {
      if (!Array.isArray(entries) || !Number.isFinite(now) || !Number.isInteger(retentionDays) || retentionDays <= 0) {
        return { kept: Array.isArray(entries) ? [...entries] : [], removed: [] };
      }

      const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
      const kept = [];
      const removed = [];

      entries.forEach((entry) => {
        if (entry && typeof entry.updatedAt === "number" && entry.updatedAt < cutoff) {
          removed.push(entry);
        } else {
          kept.push(entry);
        }
      });

      return { kept, removed };
    }

    function normalizeLinkGroups(groups) {
      if (!Array.isArray(groups)) {
        return [];
      }

      return groups.flatMap((rawGroup) => {
        if (!rawGroup || typeof rawGroup !== "object" || typeof rawGroup.name !== "string") {
          return [];
        }

        const hasGenericItems = Array.isArray(rawGroup.items);
        const sourceItems = hasGenericItems ? rawGroup.items : rawGroup.links;
        const items = [];
        const seenItems = new Set();

        (Array.isArray(sourceItems) ? sourceItems : []).forEach((rawItem) => {
          const item = typeof rawItem === "string" ? (hasGenericItems ? rawItem : rawItem.trim()) : "";

          if (!isNonEmptyText(item) || seenItems.has(item)) {
            return;
          }

          if (!hasGenericItems && !validLink(item)) {
            return;
          }

          seenItems.add(item);
          items.push(item);
        });

        if (items.length === 0) {
          return [];
        }

        const timestamp = validTimestamp(rawGroup.updatedAt) ? rawGroup.updatedAt : Date.now();
        const normalizedGroup = {
          id: typeof rawGroup.id === "string" && rawGroup.id ? rawGroup.id : createGroupId(timestamp),
          name: rawGroup.name.trim().slice(0, 80) || "قائمة محفوظة",
          icon: normalizeGroupIcon(rawGroup.icon),
          createdAt: validTimestamp(rawGroup.createdAt) ? rawGroup.createdAt : timestamp,
          updatedAt: timestamp
        };

        if (hasGenericItems) {
          normalizedGroup.items = items;
        } else {
          normalizedGroup.links = items;
        }

        return [normalizedGroup];
      });
    }

    function normalizeSmartCollection(rawCollection) {
      try {
        const smartCollection = createSmartCollection({
          id: rawCollection?.id,
          title: rawCollection?.title ?? rawCollection?.name,
          query: rawCollection?.query
        });
        const parentId = typeof rawCollection?.parentId === "string"
          && rawCollection.parentId !== smartCollection.id
          ? rawCollection.parentId
          : null;
        return Object.freeze({ ...smartCollection, parentId });
      } catch (collectionError) {
        if (!(collectionError instanceof TypeError)) {
          throw collectionError;
        }
        return null;
      }
    }

    function normalizeSmartCollections(collections) {
      if (!Array.isArray(collections)) {
        return [];
      }

      const seenIds = new Set();
      const normalizedCollections = collections.flatMap((rawCollection) => {
        const normalizedCollection = normalizeSmartCollection(rawCollection);
        if (!normalizedCollection || seenIds.has(normalizedCollection.id)) {
          return [];
        }

        seenIds.add(normalizedCollection.id);
        return [normalizedCollection];
      });

      return normalizeSmartCollectionParents(normalizedCollections);
    }

    function normalizeSmartCollectionParents(collections) {
      const collectionIds = new Set(collections.map((collection) => collection.id));
      const parentById = new Map(collections.map((collection) => [collection.id, collection.parentId]));

      return collections.map((collection) => {
        const parentId = resolveSmartCollectionParentId(collection, parentById, collectionIds);

        return parentId === collection.parentId
          ? collection
          : Object.freeze({ ...collection, parentId });
      });
    }

    function resolveSmartCollectionParentId(collection, parentById, collectionIds) {
      const visitedIds = new Set([collection.id]);
      let parentId = collection.parentId;

      while (parentId !== null) {
        if (!collectionIds.has(parentId) || visitedIds.has(parentId)) {
          return null;
        }
        visitedIds.add(parentId);
        parentId = parentById.get(parentId);
      }

      return collection.parentId;
    }

    function syncActiveSmartCollection() {
      if (activeSmartCollectionId && !state.smartCollections.some((collection) => collection.id === activeSmartCollectionId)) {
        activeSmartCollectionId = null;
      }
    }

    function loadState() {
      try {
        const savedState = localStorage.getItem(STORAGE_KEY);
        return savedState ? normalizeState(JSON.parse(savedState)) : createDefaultState();
      } catch (storageError) {
        return createDefaultState();
      }
    }

    function hydrateTrashStoreFromState(nextState, showFailureToast = false) {
      try {
        trashStore.hydrate(Array.isArray(nextState.trash) ? nextState.trash : []);
        return true;
      } catch (trashError) {
        console.warn("تعذر تحميل سلة المحذوفات.", trashError);
        trashStore.hydrate([]);
        if (showFailureToast) {
          showToast("تعذر تحميل سلة المحذوفات. تم بدء سلة فارغة.", false);
        }
        return false;
      }
    }

    function replaceStateFromStorage(nextState, showFailureToast = false) {
      const normalizedState = normalizeState(nextState);
      hydrateTrashStoreFromState(normalizedState, showFailureToast);
      state = appStateStore.replaceState({
        ...normalizedState,
        trash: trashStore.toRecords()
      });
      return state;
    }

    function stateWithDurableTrash(nextState) {
      const normalizedState = normalizeState(nextState);
      return {
        ...normalizedState,
        trash: trashStore.toRecords()
      };
    }

    function saveState(nextState) {
      const normalizedState = stateWithDurableTrash(nextState);
      state = appStateStore.replaceState(normalizedState);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
      } catch (storageError) {
        showToast("تعذر حفظ البيانات محليًا. قد تكون مساحة التخزين ممتلئة أو محظورة.", false);
      }

      if (desktopApi && desktopStateLoaded) {
        void desktopSaveQueue.enqueue(normalizedState);
      }
    }

    function normalizeClipboardMetadata(raw) {
      if (!raw || typeof raw !== "object") {
        return {};
      }

      const metadata = {};
      if (raw.sourceApp && typeof raw.sourceApp === "object" && !Array.isArray(raw.sourceApp)) {
        const sourceApp = {};
        if (typeof raw.sourceApp.executable === "string" && raw.sourceApp.executable.trim()) {
          sourceApp.executable = raw.sourceApp.executable.trim().slice(0, 260);
        }
        if (Number.isSafeInteger(raw.sourceApp.pid) && raw.sourceApp.pid > 0) {
          sourceApp.pid = raw.sourceApp.pid;
        }
        if (Object.keys(sourceApp).length > 0) {
          metadata.sourceApp = sourceApp;
        }
      }

      if (Array.isArray(raw.formats)) {
        const formats = [...new Set(raw.formats
          .filter((format) => typeof format === "string" && format.trim())
          .map((format) => format.trim()))].slice(0, 20);
        if (formats.length > 0) {
          metadata.formats = formats;
        }
      }

      if (Array.isArray(raw.richFormats)) {
        const richFormats = raw.richFormats.map((richFormat) => {
          if (!richFormat || typeof richFormat !== "object" || Array.isArray(richFormat)
            || typeof richFormat.format !== "string" || !richFormat.format.trim()) {
            return null;
          }
          const normalized = { format: richFormat.format.trim().slice(0, 64) };
          for (const property of ["mimeType", "name", "title", "url"]) {
            if (typeof richFormat[property] === "string" && richFormat[property].length <= 2048) {
              normalized[property] = richFormat[property];
            }
          }
          if (Number.isSafeInteger(richFormat.size) && richFormat.size >= 0) {
            normalized.size = richFormat.size;
          }
          if (typeof richFormat.sha256 === "string" && /^[a-f0-9]{64}$/i.test(richFormat.sha256)) {
            normalized.sha256 = richFormat.sha256.toLowerCase();
          }
          if (richFormat.available === true) {
            normalized.available = true;
          }
          return normalized;
        }).filter(Boolean).slice(0, 20);
        if (richFormats.length > 0) {
          metadata.richFormats = richFormats;
        }
      }

      if (typeof raw.note === "string" && raw.note.length <= 10000 && !/[\u0000\u007f]/.test(raw.note)) {
        metadata.note = raw.note;
      }
      if (typeof raw.title === "string" && raw.title.trim().length > 0
        && raw.title.length <= 200 && !/[\u0000-\u001f\u007f]/.test(raw.title)) {
        metadata.title = raw.title.trim();
      }
      if (typeof raw.domain === "string" && /^[^\s/?#@]{1,253}$/.test(raw.domain.trim())) {
        const domain = raw.domain.trim().toLowerCase();
        try {
          const parsedDomain = new URL(`https://${domain}`);
          if (parsedDomain.hostname === domain && !parsedDomain.port && parsedDomain.pathname === "/") {
            metadata.domain = domain;
          }
        } catch {
          // Ignore malformed optional metadata while preserving the clipboard item.
        }
      }
      if (typeof raw.ocrText === "string" && raw.ocrText.length <= 100000) {
        metadata.ocrText = raw.ocrText;
      }
      if (raw.ocr && typeof raw.ocr === "object" && !Array.isArray(raw.ocr)) {
        const ocr = {};
        for (const property of ["language", "engine"]) {
          if (typeof raw.ocr[property] === "string" && raw.ocr[property].length <= 32) {
            ocr[property] = raw.ocr[property];
          }
        }
        if (Number.isFinite(raw.ocr.confidence) && raw.ocr.confidence >= 0 && raw.ocr.confidence <= 1) {
          ocr.confidence = raw.ocr.confidence;
        }
        if (Object.keys(ocr).length > 0) {
          metadata.ocr = ocr;
        }
      }

      return metadata;
    }

    function makeEntry(text, now, clipboardMetadata = null) {
      const timestamp = typeof now === "number" ? now : Date.now();

      return {
        id: createEntryId(timestamp),
        type: "text",
        text,
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ...normalizeClipboardMetadata(clipboardMetadata)
      };
    }

    function addText(text, targetList, feedback = TEXT_FEEDBACK, clipboardMetadata = null) {
      if (!isNonEmptyText(text)) {
        if (feedback) {
          showToast(feedback.invalid, false);
        }
        return false;
      }

      const destination = targetList === "pinned" ? "pinned" : "normal";
      const existingMatch = findEntryByText(text);
      const timestamp = Date.now();

      if (existingMatch) {
        const existingEntry = existingMatch.entry;
        removeEntryById(existingMatch.listName, existingEntry.id);
        existingEntry.updatedAt = timestamp;
        Object.assign(existingEntry, normalizeClipboardMetadata(clipboardMetadata));
        state[existingMatch.listName].unshift(existingEntry);
        enforceNormalLimit();
        commitState(feedback ? feedback.duplicate : "");
        return true;
      }

      state = appStateStore.dispatch({
        type: "entry/add",
        targetList: destination,
        entry: makeEntry(text, timestamp, clipboardMetadata)
      });
      commitState(feedback ? feedback[destination] : "");
      return true;
    }

    async function addImage(blob, targetList, feedback = IMAGE_FEEDBACK, clipboardMetadata = null) {
      if (!blob || typeof blob.type !== "string" || !blob.type.startsWith("image/")) {
        if (feedback) {
          showToast(feedback.invalid, false);
        }
        return false;
      }

      if (!blob.size) {
        if (feedback) {
          showToast(feedback.empty, false);
        }
        return false;
      }

      let arrayBuffer;

      try {
        arrayBuffer = await blob.arrayBuffer();
      } catch (readError) {
        if (feedback) {
          showToast(feedback.readError, false);
        }
        return false;
      }

      const hash = hashArrayBuffer(arrayBuffer);
      const signature = imageSignature(blob.type, blob.size, hash);
      const destination = targetList === "pinned" ? "pinned" : "normal";
      const existingMatch = findEntryBySignature(signature);
      const timestamp = Date.now();

      if (existingMatch) {
        const existingEntry = existingMatch.entry;
        removeEntryById(existingMatch.listName, existingEntry.id);
        existingEntry.updatedAt = timestamp;
        Object.assign(existingEntry, normalizeClipboardMetadata(clipboardMetadata));
        state[existingMatch.listName].unshift(existingEntry);
        enforceNormalLimit();
        commitState(feedback ? feedback.duplicate : "");
        return true;
      }

      const blobKey = createEntryId(timestamp);
      let storedBlobKey = blobKey;
      let storedHash = hash;

      try {
        if (desktopApi) {
          const storedImage = await desktopApi.writeLibraryImage(blobKey, await blobToDataUrl(blob));

          if (storedImage && typeof storedImage === "object") {
            storedBlobKey = typeof storedImage.mediaKey === "string" ? storedImage.mediaKey : blobKey;
            storedHash = typeof storedImage.sha256 === "string" ? storedImage.sha256 : hash;
          }
        } else {
          await openImageDb();
          await putImageBlob(blobKey, blob);
        }
      } catch (storeError) {
        await deleteImageBlob(blobKey);
        if (feedback) {
          showToast(feedback.saveError, false);
        }
        return false;
      }

      const entry = {
        id: createEntryId(timestamp + 1),
        type: "image",
        image: { blobKey: storedBlobKey, mimeType: blob.type, size: blob.size, hash: storedHash },
        tags: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        ...normalizeClipboardMetadata(clipboardMetadata)
      };

      state[destination].unshift(entry);
      enforceNormalLimit();
      commitState(feedback ? feedback[destination] : "");
      return true;
    }

    function togglePin(id) {
      const timestamp = Date.now();
      const normalEntry = state.normal.find((entry) => entry.id === id);

      if (normalEntry) {
        state = appStateStore.dispatch({ type: "entry/pin", id, updatedAt: timestamp });
        commitState("تم التثبيت.");
        return;
      }

      const pinnedEntry = state.pinned.find((entry) => entry.id === id);

      if (pinnedEntry) {
        state = appStateStore.dispatch({ type: "entry/unpin", id, updatedAt: timestamp });
        commitState("تم إلغاء التثبيت.");
      }
    }

    function deleteEntry(listName, id) {
      const deletedEntry = state[listName].find((entry) => entry.id === id);

      if (!deletedEntry) {
        return;
      }

      const trashRecord = trashStore.remove({ entry: copyEntry(deletedEntry), listName });
      state = appStateStore.dispatch({ type: "entry/delete", listName, id });

      setUndoRecord({
        type: "single",
        recordIds: [trashRecord.id]
      });
      commitState("تم الحذف.", true);
    }

    function clearNormalWithUndo() {
      if (state.normal.length === 0) {
        showToast("لا توجد عناصر عادية لمسحها.", false);
        return;
      }

      const shouldClear = window.confirm("هل تريد مسح كل العناصر العادية؟ المثبتة لن تتأثر.");

      if (!shouldClear) {
        return;
      }

      const recordIds = state.normal.map((entry) => trashStore.remove({
        entry: copyEntry(entry),
        listName: "normal"
      }).id);
      setUndoRecord({
        type: "clear-normal",
        recordIds
      });
      state.normal = [];
      commitState("تم مسح العناصر العادية.", true);
    }

    function undoLastDeletion() {
      if (!lastUndo) {
        showToast("لا توجد عملية قابلة للتراجع.", false);
        return;
      }

      [...lastUndo.recordIds].reverse().forEach((recordId) => {
        const restored = trashStore.restore(recordId);
        if (restored) {
          restoreDeletedEntry(restored.listName, restored.entry);
        }
      });

      lastUndo = null;
      clearUndoTimer();
      enforceNormalLimit();
      commitState("تم التراجع.");
    }

    function enforceNormalLimit() {
      if (state.normal.length > NORMAL_LIMIT) {
        const evicted = state.normal.slice(NORMAL_LIMIT);
        state.normal = state.normal.slice(0, NORMAL_LIMIT);
        cleanupImageBlobs(evicted);
      }
    }

    function findEntryByText(text) {
      const pinnedEntry = state.pinned.find((entry) => entry.type !== "image" && entry.text === text);

      if (pinnedEntry) {
        return { listName: "pinned", entry: pinnedEntry };
      }

      const normalEntry = state.normal.find((entry) => entry.type !== "image" && entry.text === text);

      return normalEntry ? { listName: "normal", entry: normalEntry } : null;
    }

    function findEntryBySignature(signature) {
      const pinnedEntry = state.pinned.find((entry) => entrySignature(entry) === signature);

      if (pinnedEntry) {
        return { listName: "pinned", entry: pinnedEntry };
      }

      const normalEntry = state.normal.find((entry) => entrySignature(entry) === signature);

      return normalEntry ? { listName: "normal", entry: normalEntry } : null;
    }

    function entrySignature(entry) {
      return entry.type === "image"
        ? imageSignature(entry.image.mimeType, entry.image.size, entry.image.hash)
        : entry.text;
    }

    function imageSignature(mimeType, size, hash) {
      return `image:${mimeType}:${size}:${hash}`;
    }

    function createGroupId(timestamp) {
      return `group-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function findLinkGroup(id) {
      return state.linkGroups.find((group) => group.id === id) || null;
    }

    function selectedEntries() {
      return getVisibleEntries().filter(({ key }) => selectedCardKeys.has(key)).map(({ entry }) => entry);
    }

    function selectedEntriesWithLists() {
      return getVisibleEntries().filter(({ key }) => selectedCardKeys.has(key));
    }

    function toggleSelectedPins() {
      const selected = selectedEntriesWithLists();
      if (selected.length === 0) {
        return;
      }

      const selectedIds = new Set(selected.map(({ entry }) => entry.id));
      const toPin = selected.filter(({ listName }) => listName === "normal").map(({ entry }) => entry);
      const toUnpin = selected.filter(({ listName }) => listName === "pinned").map(({ entry }) => entry);
      const timestamp = Date.now();

      toPin.forEach((entry) => { entry.updatedAt = timestamp; });
      toUnpin.forEach((entry) => { entry.updatedAt = timestamp; });
      state.pinned = [...toPin, ...state.pinned.filter((entry) => !selectedIds.has(entry.id))];
      state.normal = [...toUnpin, ...state.normal.filter((entry) => !selectedIds.has(entry.id))];
      enforceNormalLimit();
      commitState("تم نقل العناصر المحددة.");
    }

    function deleteSelectedEntries() {
      const selected = selectedEntriesWithLists();
      if (selected.length === 0 || !window.confirm(`حذف ${selected.length} عناصر محددة؟`)) {
        return;
      }

      const selectedIds = new Set(selected.map(({ entry }) => entry.id));
      const recordIds = selected.map(({ listName, entry }) => trashStore.remove({
        entry: copyEntry(entry),
        listName
      }).id);
      state.pinned = state.pinned.filter((entry) => !selectedIds.has(entry.id));
      state.normal = state.normal.filter((entry) => !selectedIds.has(entry.id));
      setUndoRecord({
        type: "bulk",
        recordIds
      });
      commitState(`تم حذف ${selected.length} عناصر.`, true);
    }

    function tagSelectedEntries() {
      const selected = selectedEntriesWithLists();
      if (selected.length === 0) {
        return;
      }

      const tag = window.prompt("اكتب الوسم الذي تريد إضافته:", "");
      const normalizedTag = typeof tag === "string" ? tag.trim().slice(0, 30) : "";
      if (!normalizedTag) {
        return;
      }

      selected.forEach(({ entry }) => {
        const tags = normalizeTags(entry.tags);
        if (!tags.includes(normalizedTag) && tags.length < 20) {
          tags.push(normalizedTag);
          entry.tags = tags;
          entry.updatedAt = Date.now();
        }
      });
      commitState("تمت إضافة الوسم للعناصر المحددة.");
    }

    function getVisibleEntries() {
      const collectionQuery = currentSmartCollectionQuery();
      const matchesVisibleFilter = (entry) => !collectionQuery || matchesCollectionQuery(entry, collectionQuery);

      return [
        ...state.pinned
          .filter(matchesVisibleFilter)
          .map((entry) => ({ key: `pinned:${entry.id}`, listName: "pinned", entry })),
        ...state.normal
          .filter(matchesVisibleFilter)
          .map((entry) => ({ key: `normal:${entry.id}`, listName: "normal", entry }))
      ];
    }

    function updateSelection(clickedKey, ctrlKey, shiftKey) {
      const orderedKeys = getVisibleEntries().map(({ key }) => key);
      const currentIndex = orderedKeys.indexOf(clickedKey);

      if (currentIndex < 0) {
        return;
      }

      if (shiftKey && selectionAnchorKey && orderedKeys.includes(selectionAnchorKey)) {
        const anchorIndex = orderedKeys.indexOf(selectionAnchorKey);
        const rangeStart = Math.min(anchorIndex, currentIndex);
        const rangeEnd = Math.max(anchorIndex, currentIndex);

        if (ctrlKey) {
          for (let index = rangeStart; index <= rangeEnd; index += 1) {
            selectedCardKeys.add(orderedKeys[index]);
          }
        } else {
          selectedCardKeys = new Set(orderedKeys.slice(rangeStart, rangeEnd + 1));
        }

        return;
      }

      if (ctrlKey) {
        if (selectedCardKeys.has(clickedKey)) {
          selectedCardKeys.delete(clickedKey);
        } else {
          selectedCardKeys.add(clickedKey);
        }
        selectionAnchorKey = clickedKey;
        return;
      }

      selectedCardKeys = new Set([clickedKey]);
      selectionAnchorKey = clickedKey;
    }

    function clearSelection() {
      selectedCardKeys.clear();
      selectionAnchorKey = null;
      render();
    }

    function reconcileSelection() {
      const visibleEntries = getVisibleEntries();
      const visibleKeys = new Set(visibleEntries.map(({ key }) => key));
      const visibleIds = new Set(visibleEntries.map(({ entry }) => entry.id));
      const nextSelection = new Set();

      selectedCardKeys.forEach((key) => {
        if (visibleKeys.has(key)) {
          nextSelection.add(key);
          return;
        }

        const entryId = key.slice(key.indexOf(":") + 1);
        const movedEntry = visibleEntries.find(({ entry }) => entry.id === entryId);

        if (movedEntry) {
          nextSelection.add(movedEntry.key);
        }
      });

      selectedCardKeys = nextSelection;
      if (selectionAnchorKey && !visibleKeys.has(selectionAnchorKey)) {
        const anchorId = selectionAnchorKey.slice(selectionAnchorKey.indexOf(":") + 1);
        selectionAnchorKey = visibleIds.has(anchorId)
          ? visibleEntries.find(({ entry }) => entry.id === anchorId).key
          : null;
      }
    }

    function getSavedGroupItems(group) {
      return Array.isArray(group?.items) ? group.items : (Array.isArray(group?.links) ? group.links : []);
    }

    function dedupeSavedItems(items) {
      const seen = new Set();
      return items.filter((item) => {
        if (!isNonEmptyText(item) || seen.has(item)) {
          return false;
        }

        seen.add(item);
        return true;
      });
    }

    function parseGroupItems(rawText) {
      return dedupeSavedItems(splitClipboardBatch(rawText, state.settings.batchSeparator));
    }

    function openLinkGroupEditor(group = null, initialItems = []) {
      editingLinkGroupId = group ? group.id : null;
      selectedGroupIcon = normalizeGroupIcon(group ? group.icon : DEFAULT_GROUP_ICON);
      elements.linkGroupNameInput.value = group ? group.name : "";
      elements.linkGroupLinksInput.value = joinClipboardBatch(group ? getSavedGroupItems(group) : initialItems, state.settings.batchSeparator);
      renderGroupIconPicker();
      elements.linkGroupDialog.showModal();
      elements.linkGroupNameInput.focus();
    }

    function selectGroupIcon(event) {
      const clickedOption = event.target instanceof Element
        ? event.target.closest(".group-icon-option")
        : null;

      if (!clickedOption || !elements.groupIconPicker.contains(clickedOption)) {
        return;
      }

      selectedGroupIcon = normalizeGroupIcon(clickedOption.dataset.iconName);
      renderGroupIconPicker();
    }

    function renderGroupIconPicker() {
      elements.groupIconPicker.replaceChildren();

      GROUP_ICON_CATALOG.forEach((icon) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "group-icon-option";
        option.dataset.iconName = icon.name;
        option.setAttribute("role", "radio");
        option.setAttribute("aria-label", icon.label);
        option.title = icon.label;
        option.setAttribute("aria-checked", String(icon.name === selectedGroupIcon));
        option.classList.toggle("is-selected", icon.name === selectedGroupIcon);
        option.append(createIconMarkup(icon.name));
        elements.groupIconPicker.append(option);
      });
    }

    function saveLinkGroupFromForm(event) {
      event.preventDefault();
      const name = elements.linkGroupNameInput.value.trim();
      const items = parseGroupItems(elements.linkGroupLinksInput.value);

      if (!name || items.length === 0) {
        showToast("أدخل اسم القائمة وعنصرًا واحدًا على الأقل.", false);
        return;
      }

      const timestamp = Date.now();
      const existingGroup = editingLinkGroupId ? findLinkGroup(editingLinkGroupId) : null;

      if (existingGroup) {
        existingGroup.name = name.slice(0, 80);
        existingGroup.icon = normalizeGroupIcon(selectedGroupIcon);
        delete existingGroup.links;
        existingGroup.items = items;
        existingGroup.updatedAt = timestamp;
      } else {
        state.linkGroups.unshift({
          id: createGroupId(timestamp),
          name: name.slice(0, 80),
          icon: normalizeGroupIcon(selectedGroupIcon),
          items,
          createdAt: timestamp,
          updatedAt: timestamp
        });
      }

      elements.linkGroupDialog.close();
      editingLinkGroupId = null;
      commitState(existingGroup ? "تم تعديل القائمة." : "تم حفظ القائمة.");
    }

    function deleteLinkGroup(id) {
      const group = findLinkGroup(id);

      if (!group || !window.confirm(`حذف قائمة «${group.name}»؟`)) {
        return;
      }

      state.linkGroups = state.linkGroups.filter((candidate) => candidate.id !== id);
      commitState("تم حذف القائمة.");
    }

    function moveLinkGroup(id, direction) {
      const currentIndex = state.linkGroups.findIndex((group) => group.id === id);
      const nextIndex = currentIndex + direction;

      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= state.linkGroups.length) {
        return;
      }

      [state.linkGroups[currentIndex], state.linkGroups[nextIndex]] = [state.linkGroups[nextIndex], state.linkGroups[currentIndex]];
      commitState("تم تغيير ترتيب القائمة.");
    }

    function openSavedLinkGroup(group) {
      const items = getSavedGroupItems(group);

      if (!items.every((item) => validLink(item))) {
        void copyText(joinClipboardBatch(items, state.settings.batchSeparator));
        return;
      }

      if (!desktopApi) {
        void copyText(joinClipboardBatch(items, state.settings.batchSeparator));
        showToast("تم نسخ عناصر القائمة؛ فتح الروابط متاح في نسخة سطح المكتب.");
        return;
      }

      void desktopApi.openLinkGroup(items)
        .then((openResult) => {
          showToast(openResult.browser === "chrome" ? `فُتحت ${openResult.count} تبويبات في Chrome.` : "Chrome غير موجود؛ فُتحت الروابط بالمتصفح الافتراضي.");
        })
        .catch(() => showToast("تعذر فتح قائمة الروابط؛ تم نسخها بدلًا من ذلك.", false));
    }

    function createSmartCollectionId(timestamp) {
      return `smart-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function findSmartCollection(collectionId) {
      return state.smartCollections.find((collection) => collection.id === collectionId) || null;
    }

    function currentSmartCollectionDraft() {
      return {
        text: state.settings.searchQuery,
        type: searchType === "all" ? undefined : searchType,
        tags: searchTag ? [searchTag] : []
      };
    }

    function currentSmartCollectionQuery() {
      return findSmartCollection(activeSmartCollectionId)?.query || null;
    }

    function createSmartCollectionFromFilters() {
      const title = window.prompt("اسم التجميعة الذكية:", "تجميعة جديدة");
      if (typeof title !== "string" || !title.trim()) {
        return;
      }

      const collection = normalizeSmartCollection({
        id: createSmartCollectionId(Date.now()),
        title: title.trim().slice(0, 80),
        query: currentSmartCollectionDraft(),
        parentId: null
      });
      state.smartCollections = [collection, ...state.smartCollections];
      activeSmartCollectionId = collection.id;
      commitState("تم حفظ التجميعة الذكية.");
    }

    function applySmartCollection(collectionId) {
      const collection = findSmartCollection(collectionId);
      if (!collection) {
        return;
      }

      activeSmartCollectionId = collection.id;
      clearSelection();
      render();
      showToast(`تم تطبيق «${collection.title}».`);
    }

    function clearActiveSmartCollection() {
      if (!activeSmartCollectionId) {
        return;
      }

      activeSmartCollectionId = null;
      clearSelection();
      render();
    }

    function renameSmartCollection(collectionId) {
      const collection = findSmartCollection(collectionId);
      if (!collection) {
        return;
      }

      const title = window.prompt("اسم التجميعة الذكية:", collection.title);
      if (typeof title !== "string" || !title.trim()) {
        return;
      }

      state.smartCollections = state.smartCollections.map((candidate) => candidate.id === collection.id
        ? normalizeSmartCollection({
          id: candidate.id,
          title: title.trim().slice(0, 80),
          query: candidate.query,
          parentId: candidate.parentId
        })
        : candidate);
      commitState("تم تعديل اسم التجميعة.");
    }

    function deleteSmartCollection(collectionId) {
      const collection = findSmartCollection(collectionId);
      if (!collection || !window.confirm(`حذف التجميعة «${collection.title}»؟`)) {
        return;
      }

      state.smartCollections = state.smartCollections.filter((candidate) => candidate.id !== collectionId);
      if (activeSmartCollectionId === collectionId) {
        activeSmartCollectionId = null;
      }
      commitState("تم حذف التجميعة.");
    }

    function formatTrashDate(timestamp) {
      if (!validTimestamp(timestamp)) {
        return "تاريخ غير معروف";
      }

      return new Date(timestamp).toLocaleString("ar-EG", {
        dateStyle: "short",
        timeStyle: "short"
      });
    }

    function trashEntryPreview(entry) {
      return entry?.type === "image" ? "صورة محفوظة" : quickPalettePreviewText(entry?.text);
    }

    function createDrawerTextPair(primaryText, primaryClass, secondaryText, secondaryClass) {
      const label = document.createElement("div");
      label.className = "drawer-row-label";
      const primary = document.createElement("p");
      primary.className = primaryClass;
      primary.textContent = primaryText;
      primary.title = primaryText;
      const secondary = document.createElement("small");
      secondary.className = secondaryClass;
      secondary.textContent = secondaryText;
      label.append(primary, secondary);
      return label;
    }

    function createDrawerCountBadge(matchingCount) {
      const count = document.createElement("span");
      count.className = "drawer-count-badge";
      count.textContent = String(matchingCount);
      count.setAttribute("aria-label", `${count.textContent} عنصر مطابق`);
      return count;
    }

    function createSmartCollectionRow(collection) {
      const matchingCount = evaluateCollection(state, collection.query).length;
      const wrapper = document.createElement("div");
      wrapper.className = "drawer-row";
      wrapper.classList.toggle("is-active", collection.id === activeSmartCollectionId);
      wrapper.style.paddingInlineStart = `${smartCollectionDepth(collection)}rem`;
      const main = document.createElement("div");
      main.className = "drawer-row-main";
      main.append(
        createIconButton("star", `تطبيق ${collection.title}`, () => applySmartCollection(collection.id), "drawer-group-icon"),
        createDrawerTextPair(collection.title, "drawer-group-name", `${matchingCount} عنصر مطابق`, "drawer-item-meta"),
        createDrawerCountBadge(matchingCount)
      );
      const actions = document.createElement("div");
      actions.className = "drawer-actions";
      actions.append(
        createDrawerButton("pencil", "إعادة تسمية", () => renameSmartCollection(collection.id)),
        createDrawerButton("trash", "حذف التجميعة", () => deleteSmartCollection(collection.id))
      );
      wrapper.append(main, actions);
      return wrapper;
    }

    function smartCollectionDepth(collection) {
      const collectionsById = new Map(state.smartCollections.map((candidate) => [candidate.id, candidate]));
      const visitedIds = new Set([collection.id]);
      let depth = 0;
      let parentId = collection.parentId;

      while (parentId && !visitedIds.has(parentId)) {
        const parent = collectionsById.get(parentId);
        if (!parent) {
          break;
        }
        depth += 1;
        visitedIds.add(parentId);
        parentId = parent.parentId;
      }

      return Math.min(depth, 8);
    }

    function createTrashRestoreButton(record) {
      return createDrawerButton("copy", "استعادة", () => {
        const restored = restoreTrashRecord(record.id);
        if (restored) {
          showToast("تم استعادة العنصر.");
        }
      });
    }

    function createTrashPurgeButton(record) {
      return createDrawerButton("trash", "حذف نهائي", () => {
        if (!window.confirm("حذف هذا العنصر نهائيًا؟ لا يمكن التراجع عن ذلك.")) {
          return;
        }
        if (purgeTrashRecord(record.id)) {
          showToast("تم حذف العنصر نهائيًا.");
        }
      });
    }

    function createTrashRow(record) {
      const wrapper = document.createElement("div");
      wrapper.className = "drawer-row";
      const main = document.createElement("div");
      main.className = "drawer-row-main";
      const listLabel = record.originalList === "pinned" ? "مثبتة" : "عادية";
      main.append(
        createIconButton("trash", "استعادة", () => restoreTrashRecord(record.id), "drawer-group-icon"),
        createDrawerTextPair(trashEntryPreview(record.entry), "drawer-item-preview", `${listLabel} · ${formatTrashDate(record.deletedAt)}`, "drawer-item-meta")
      );
      const actions = document.createElement("div");
      actions.className = "drawer-actions";
      actions.append(createTrashRestoreButton(record), createTrashPurgeButton(record));
      wrapper.append(main, actions);
      return wrapper;
    }

    function renderSmartCollections() {
      syncActiveSmartCollection();
      elements.smartCollectionList.replaceChildren(...state.smartCollections.map(createSmartCollectionRow));
      elements.smartCollectionsEmpty.classList.toggle("hidden", state.smartCollections.length > 0);
      elements.clearActiveCollectionButton.hidden = !activeSmartCollectionId;
    }

    function renderTrashRecords() {
      const trashRecords = trashStore.list();
      elements.trashList.replaceChildren(...trashRecords.map(createTrashRow));
      elements.trashEmpty.classList.toggle("hidden", trashRecords.length > 0);
    }

    function renderLinkGroups() {
      elements.linkGroupList.replaceChildren();
      elements.linkGroupEmpty.classList.toggle("hidden", state.linkGroups.length > 0);

      state.linkGroups.forEach((group) => {
        const displayModel = getGroupDisplayModel(group, linkDrawerCompact);
        const wrapper = document.createElement("div");
        wrapper.className = "drawer-group";

        const heading = document.createElement("div");
        heading.className = "drawer-group-heading";

        const icon = createIconButton(displayModel.icon, `فتح أو نسخ ${displayModel.ariaLabel}`, () => openSavedLinkGroup(group), "drawer-group-icon");

        const label = document.createElement("div");
        label.className = "drawer-group-label";
        const name = document.createElement("p");
        name.className = "drawer-group-name";
        name.textContent = displayModel.name;
        const meta = document.createElement("small");
        meta.className = "drawer-group-meta";
        meta.textContent = `${getSavedGroupItems(group).length} عنصر`;
        label.append(name, meta);

        heading.append(icon, label);

        const actions = document.createElement("div");
        actions.className = "drawer-actions";
        const copyButton = createDrawerButton("copy", "نسخ القائمة", () => void copyText(joinClipboardBatch(getSavedGroupItems(group), state.settings.batchSeparator)));
        const editButton = createDrawerButton("pencil", "تعديل القائمة", () => openLinkGroupEditor(group));
        const deleteButton = createDrawerButton("trash", "حذف القائمة", () => deleteLinkGroup(group.id));
        const moveUpButton = createDrawerButton("chevronUp", "نقل القائمة للأعلى", () => moveLinkGroup(group.id, -1));
        const moveDownButton = createDrawerButton("chevronDown", "نقل القائمة للأسفل", () => moveLinkGroup(group.id, 1));
        actions.append(copyButton, editButton, moveUpButton, moveDownButton, deleteButton);
        wrapper.append(heading, actions);
        elements.linkGroupList.append(wrapper);
      });
    }

    function createDrawerButton(iconName, label, onClick) {
      const button = createIconButton(iconName, label, onClick);
      const text = document.createElement("span");
      text.className = "drawer-button-label";
      text.textContent = label;
      button.append(text);
      return button;
    }

    function setLinkDrawerCompact(compact) {
      linkDrawerCompact = Boolean(compact);
      elements.linkDrawer.classList.toggle("is-compact", linkDrawerCompact);
      elements.toggleLinkDrawerSizeButton.title = linkDrawerCompact ? "توسيع القائمة" : "تصغير القائمة";
      elements.toggleLinkDrawerSizeButton.setAttribute("aria-label", linkDrawerCompact ? "توسيع قائمة الروابط" : "تصغير قائمة الروابط");
      elements.toggleLinkDrawerSizeButton.setAttribute("aria-pressed", String(linkDrawerCompact));
      saveLinkDrawerCompactPreference();

      if (linkDrawerOpen) {
        renderSmartCollections();
        renderLinkGroups();
        renderTrashRecords();
      }
    }

    function setLinkDrawer(open) {
      linkDrawerOpen = open;
      elements.linkDrawer.hidden = !open;
      elements.drawerBackdrop.hidden = !open;
      elements.linkMenuButton.setAttribute("aria-expanded", String(open));
      setLinkDrawerCompact(linkDrawerCompact);

      if (open) {
        renderSmartCollections();
        renderLinkGroups();
        renderTrashRecords();
      }
    }

    function setToolsMenu(open) {
      toolsMenuOpen = Boolean(open);
      elements.toolsMenu.hidden = !toolsMenuOpen;
      elements.toolsMenuButton.setAttribute("aria-expanded", String(toolsMenuOpen));
    }

    function getQuickPaletteEntries() {
      return [...state.pinned, ...state.normal];
    }

    function ensureQuickPalette() {
      if (quickPalette) {
        return quickPalette;
      }

      quickPalette = new QuickPalette({
        copy: async (entry) => {
          const copied = await copyEntryContent(entry);
          if (copied === false) {
            throw new Error("Clipboard write failed");
          }
        },
        onClose: hideQuickPalette
      });
      return quickPalette;
    }

    function openQuickPalette() {
      const palette = ensureQuickPalette();

      if (elements.settingsDialog.open) {
        elements.settingsDialog.close();
      }
      if (elements.linkGroupDialog.open) {
        elements.linkGroupDialog.close();
      }
      if (linkDrawerOpen) {
        setLinkDrawer(false);
      }

      quickPaletteFocusReturn = document.activeElement instanceof HTMLElement
        && !elements.quickPalette.contains(document.activeElement)
        ? document.activeElement
        : document.body;
      palette.setQuery("");
      palette.open(getQuickPaletteEntries());
      quickPaletteOpen = true;
      elements.quickPalette.hidden = false;
      elements.quickPaletteInput.value = "";
      renderQuickPalette();
      elements.quickPaletteInput.focus();
    }

    function closeQuickPalette() {
      if (quickPalette && quickPalette.getState().open) {
        quickPalette.close();
        return;
      }

      hideQuickPalette();
    }

    function hideQuickPalette() {
      quickPaletteOpen = false;
      elements.quickPalette.hidden = true;
      elements.quickPaletteList.replaceChildren();
      elements.quickPaletteEmpty.hidden = true;

      restoreQuickPaletteFocus(quickPaletteFocusReturn);
      quickPaletteFocusReturn = null;
    }

    function renderQuickPalette() {
      if (!quickPaletteOpen || !quickPalette) {
        return;
      }

      const paletteState = quickPalette.getState();
      elements.quickPaletteEmpty.hidden = paletteState.items.length > 0;
      elements.quickPaletteList.replaceChildren();

      paletteState.items.forEach((entry, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "quick-palette-option";
        option.id = quickPaletteOptionId(entry, index);
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === paletteState.activeIndex));
        option.title = entry.type === "image" ? "نسخ الصورة" : entry.text;
        option.addEventListener("click", () => void activateQuickPaletteEntry(index));

        const position = document.createElement("span");
        position.className = "quick-palette-position";
        position.textContent = String(index + 1);

        const kind = document.createElement("span");
        kind.className = "quick-palette-kind";
        kind.textContent = entry.type === "image" ? "صورة" : "نص";

        const preview = document.createElement("span");
        preview.className = "quick-palette-preview";
        preview.textContent = entry.type === "image" ? "صورة محفوظة" : quickPalettePreviewText(entry.text);

        option.append(position, kind, preview);
        elements.quickPaletteList.append(option);
      });
      syncQuickPaletteAccessibility(elements.quickPaletteInput, elements.quickPaletteList, paletteState.items, paletteState.activeIndex);
    }

    function quickPalettePreviewText(text) {
      if (typeof text !== "string") {
        return "";
      }

      return text.split(/\r?\n/, 1)[0] || "نص فارغ";
    }

    async function activateQuickPaletteEntry(index) {
      if (!quickPaletteOpen || !quickPalette) {
        return;
      }

      quickPalette.select(index);
      const result = await quickPalette.activate(index);

      if (result.error) {
        showToast("تعذر نسخ العنصر من القائمة السريعة.", false);
      }
      renderQuickPalette();
    }

    async function handleQuickPaletteKeydown(event) {
      if (!quickPaletteOpen || !quickPalette) {
        return;
      }

      const result = await quickPalette.handleKey(event);
      if (result?.error) {
        showToast("تعذر نسخ العنصر من القائمة السريعة.", false);
      }
      renderQuickPalette();
    }

    function getItemsFromSelection() {
      return dedupeSavedItems(selectedEntries()
        .filter((entry) => entry.type === "text")
        .flatMap((entry) => splitClipboardBatch(entry.text, state.settings.batchSeparator)));
    }

    function createGroupFromSelection() {
      const selected = selectedEntries();
      const items = getItemsFromSelection();
      const skippedCount = selected.filter((entry) => entry.type !== "text").length;

      if (items.length === 0) {
        showToast("لا يمكن حفظ القائمة: حدد كرتًا نصيًا واحدًا على الأقل.", false);
        return;
      }

      if (skippedCount > 0) {
        showToast(`سيتم تجاهل ${skippedCount} عناصر غير نصية.`);
      }

      setLinkDrawer(true);
      openLinkGroupEditor(null, items);
    }

    async function copySelectedAsBatch() {
      const textEntries = selectedEntries().filter((entry) => entry.type === "text");

      if (textEntries.length === 0) {
        showToast("حدد كروت نصية لنسخها كدفعة.", false);
        return;
      }

      const sequenceEntries = textEntries.map((entry) => ({ id: entry.id, text: entry.text }));
      if (await writeSelectedPasteSequence(sequenceEntries)) {
        return;
      }

      await copyText(joinClipboardBatch(sequenceEntries.map((entry) => entry.text), state.settings.batchSeparator));
    }

    async function writeSelectedPasteSequence(sequenceEntries) {
      if (!desktopApi?.writePasteSequence) {
        return false;
      }

      const separator = `\n${state.settings.batchSeparator}\n`;
      if (separator.length > 80) {
        return false;
      }

      try {
        await desktopApi.writePasteSequence(sequenceEntries, {
          separator
        });
        showToast("تم نسخ السلسلة.");
        return true;
      } catch (sequenceError) {
        console.debug("نسخ السلسلة غير متاح، سيتم استخدام المسار المعتاد.", sequenceError);
        return false;
      }
    }

    function render() {
      elements.pinnedCount.textContent = `مثبتة: ${state.pinned.length}`;
      elements.normalCount.textContent = `عادية: ${state.normal.length}/${NORMAL_LIMIT}`;
      elements.pinnedEmpty.classList.toggle("hidden", state.pinned.length > 0);
      elements.normalEmpty.classList.toggle("hidden", state.normal.length > 0);
      updateAutoCaptureToggle();
      updateGlobalShortcutToggle();
      updatePrivacyControls();
      renderSearchControls();
      elements.batchSeparatorInput.value = state.settings.batchSeparator;
      renderLibrary.incremental(state, renderList);
      renderSelectionToolbar();
      renderQuickPalette();
      if (linkDrawerOpen) {
        renderSmartCollections();
        renderLinkGroups();
        renderTrashRecords();
      }
    }

    function renderSelectionToolbar() {
      const selectedCount = selectedCardKeys.size;
      elements.selectionToolbar.hidden = selectedCount === 0;
      elements.selectionCount.textContent = `${selectedCount} محدد`;
      const selected = selectedEntriesWithLists();
      const allNormal = selected.length > 0 && selected.every(({ listName }) => listName === "normal");
      const allPinned = selected.length > 0 && selected.every(({ listName }) => listName === "pinned");
      elements.toggleSelectionPinsButton.textContent = allNormal ? "تثبيت" : allPinned ? "إرجاع" : "نقل";
      elements.toggleSelectionPinsButton.title = allNormal ? "تثبيت المحدد" : allPinned ? "إرجاع المحدد للعادية" : "تثبيت أو إرجاع المحدد";
    }

    function renderSearchControls() {
      if (document.activeElement !== elements.searchInput) {
        elements.searchInput.value = state.settings.searchQuery;
      }

      elements.searchType.value = searchType;
      renderTagOptions();
      elements.searchTag.value = searchTag;
      if (document.activeElement !== elements.searchSource) {
        elements.searchSource.value = searchSource;
      }
      if (document.activeElement !== elements.searchDateFrom) {
        elements.searchDateFrom.value = searchDateFrom;
      }
      if (document.activeElement !== elements.searchDateTo) {
        elements.searchDateTo.value = searchDateTo;
      }
    }

    function renderTagOptions() {
      const tags = [...new Set([...state.pinned, ...state.normal]
        .flatMap((entry) => Array.isArray(entry.tags) ? entry.tags : []))]
        .sort((left, right) => left.localeCompare(right, "ar"));
      const currentTag = searchTag;
      elements.searchTag.replaceChildren(new Option("كل الوسوم", ""));
      tags.forEach((tag) => elements.searchTag.append(new Option(tag, tag)));

      if (currentTag && !tags.includes(currentTag)) {
        searchTag = "";
      }
    }

    function setSearchPanel(open) {
      searchPanelOpen = open;
      elements.searchPanel.hidden = !open;
      elements.searchToggleButton.setAttribute("aria-expanded", String(open));

      if (open) {
        elements.searchInput.focus();
      }
    }

    function saveSearchQuerySoon() {
      if (searchSaveTimer) {
        window.clearTimeout(searchSaveTimer);
      }

      searchSaveTimer = window.setTimeout(() => {
        saveState(state);
        searchSaveTimer = null;
      }, 250);
    }

    function renderList(listName, entries) {
      const listElement = listName === "pinned" ? elements.pinnedList : elements.normalList;
      const collectionQuery = currentSmartCollectionQuery();
      let filteredEntries = collectionQuery
        ? [...entries]
        : filterLibraryEntries(entries, {
          query: state.settings.searchQuery,
          type: searchType,
          tag: searchTag,
          source: searchSource,
          dateFrom: searchDateFrom,
          dateTo: searchDateTo,
          includeMetadata: true
        });
      filteredEntries = filteredEntries.filter((entry) => !collectionQuery || matchesCollectionQuery(entry, collectionQuery));
      const previousCards = renderedCardCache[listName];
      const nextCards = new Map();
      const cards = [];

      filteredEntries.forEach((entry, index) => {
        const signature = entryRenderSignature(entry);
        const previous = previousCards.get(entry.id);
        let card = previous?.card;

        if (!card || previous.signature !== signature) {
          if (card) {
            releaseCardImage(card);
          }
          card = buildEntryCard(entry, listName, index);
        }

        updateEntryCardPresentation(card, entry, listName, index);
        nextCards.set(entry.id, { card, signature });
        cards.push(card);
      });

      previousCards.forEach(({ card }, entryId) => {
        if (!nextCards.has(entryId)) {
          releaseCardImage(card);
        }
      });

      renderedCardCache[listName] = nextCards;
      listElement.replaceChildren(...cards);

      if (entries.length > 0 && filteredEntries.length === 0) {
        const emptyFilter = document.createElement("p");
        emptyFilter.className = "empty-state";
        emptyFilter.textContent = "لا توجد نتائج";
        listElement.append(emptyFilter);
      }
    }

    function entryRenderSignature(entry) {
      const tags = Array.isArray(entry.tags) ? entry.tags.join("\u001f") : "";

      if (entry.type === "image") {
        const image = entry.image || {};
        return [
          entry.id,
          entry.type,
          entry.updatedAt,
          tags,
          image.blobKey,
          image.mimeType,
          image.size,
          image.hash
        ].join("\u001f");
      }

      return [entry.id, entry.type, entry.updatedAt, tags, entry.text, JSON.stringify(entry.searchRanges || [])].join("\u001f");
    }

    function updateEntryCardPresentation(card, entry, listName, index) {
      const cardKey = `${listName}:${entry.id}`;
      const isSelected = selectedCardKeys.has(cardKey);
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-selected", String(isSelected));

      const numberBadge = card.querySelector(".entry-number");
      if (numberBadge) {
        numberBadge.textContent = String(index + 1);
      }

      const kindLabel = entry.type === "image" ? "صورة" : "نص";
      const groupLabel = listName === "pinned" ? "مثبتة" : "عادية";
      card.setAttribute("aria-label", `${kindLabel} ${groupLabel} رقم ${index + 1}، Ctrl+C للنسخ`);
    }

    function buildEntryCard(entry, listName, index) {
      const card = document.createElement("article");
      const cardKey = `${listName}:${entry.id}`;
      card.className = `entry-card${selectedCardKeys.has(cardKey) ? " is-selected" : ""}`;
      card.draggable = true;
      card.tabIndex = 0;
      card.dataset.entryId = entry.id;
      card.dataset.listName = listName;
      card.setAttribute("aria-selected", String(selectedCardKeys.has(cardKey)));

      const kindLabel = entry.type === "image" ? "صورة" : "نص";
      const groupLabel = listName === "pinned" ? "مثبتة" : "عادية";
      card.setAttribute("aria-label", `${kindLabel} ${groupLabel} رقم ${index + 1}، Ctrl+C للنسخ`);

      card.addEventListener("dragstart", (event) => handleEntryDragStart(event, entry));
      card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
      card.addEventListener("click", (event) => {
        const clickedControl = event.target instanceof Element && event.target.closest("button, input, textarea, a");

        if (clickedControl) {
          return;
        }

        updateSelection(cardKey, event.ctrlKey || event.metaKey, event.shiftKey);
        render();
      });
      card.addEventListener("dblclick", (event) => {
        const clickedControl = event.target instanceof Element && event.target.closest("button, input, textarea, a");
        if (!clickedControl) {
          void openEntryInspector(entry, listName);
        }
      });

      const numberBadge = document.createElement("span");
      numberBadge.className = "entry-number";
      numberBadge.textContent = String(index + 1);
      numberBadge.setAttribute("aria-hidden", "true");

      const contentBlock = entry.type === "image" ? buildImageContent(entry) : buildTextContent(entry);

      const row = document.createElement("div");
      row.className = "entry-row";
      row.append(numberBadge, contentBlock);

      card.append(row, buildEntryTags(entry), buildCardActions(entry, listName));
      return card;
    }

    async function openEntryInspector(entry, listName) {
      const model = inspectEntry(entry, { state, listMemberships: [listName] });
      if (!model) {
        return;
      }

      if (inspectorObjectUrl) {
        URL.revokeObjectURL(inspectorObjectUrl);
        inspectorObjectUrl = null;
      }
      elements.inspectorPreview.replaceChildren();
      elements.inspectorMetadata.replaceChildren();

      if (model.type === "image") {
        const image = document.createElement("img");
        image.className = "inspector-image";
        image.alt = "الصورة المحفوظة";
        elements.inspectorPreview.append(image);
        try {
          const blob = await getImageBlob(entry.image.blobKey);
          if (!blob) {
            throw new Error("image unavailable");
          }
          inspectorObjectUrl = URL.createObjectURL(blob);
          image.src = inspectorObjectUrl;
        } catch (error) {
          image.remove();
          const unavailable = document.createElement("p");
          unavailable.className = "empty-state";
          unavailable.textContent = "تعذر تحميل الصورة من التخزين المحلي.";
          elements.inspectorPreview.append(unavailable);
        }
      } else {
        const text = document.createElement("pre");
        text.className = "inspector-text";
        text.textContent = model.text;
        elements.inspectorPreview.append(text);
      }

      const metadata = [
        ["النوع", model.type === "image" ? "صورة" : "نص"],
        ["التاريخ", model.capturedAt],
        ["المصدر", model.source?.executable || "غير معروف"],
        ["الحجم", model.size === undefined ? "—" : `${model.size} بايت`],
        ["الهاش", model.hash || "—"],
        ["الوسوم", model.tags.length > 0 ? model.tags.join("، ") : "—"],
        ["العنوان", entry.title || "—"],
        ["النطاق", entry.domain || "—"],
        ["الملاحظة", entry.note || "—"],
        ["لغة OCR", entry.ocr?.language || "—"]
      ];
      metadata.forEach(([label, value]) => {
        const term = document.createElement("dt");
        term.textContent = label;
        const description = document.createElement("dd");
        description.textContent = value === undefined || value === null ? "—" : String(value);
        elements.inspectorMetadata.append(term, description);
      });

      elements.inspectorDialog.showModal();
    }

    function closeEntryInspector() {
      if (inspectorObjectUrl) {
        URL.revokeObjectURL(inspectorObjectUrl);
        inspectorObjectUrl = null;
      }
      if (elements.inspectorDialog.open) {
        elements.inspectorDialog.close();
      }
      elements.inspectorPreview.replaceChildren();
      elements.inspectorMetadata.replaceChildren();
    }

    function buildEntryTags(entry) {
      const tags = document.createElement("div");
      tags.className = "entry-tags";

      (Array.isArray(entry.tags) ? entry.tags : []).forEach((tag) => {
        const tagElement = document.createElement("span");
        tagElement.className = "entry-tag";
        tagElement.textContent = tag;
        tags.append(tagElement);
      });

      return tags;
    }

    function buildTextContent(entry) {
      const wrapper = document.createElement("div");
      wrapper.className = "entry-content";

      const textBlock = document.createElement("pre");
      textBlock.className = "entry-text";
      appendHighlightedText(textBlock, entry.text, entry.searchRanges);
      wrapper.append(textBlock);
      return wrapper;
    }

    function appendHighlightedText(container, text, ranges) {
      if (!Array.isArray(ranges) || ranges.length === 0) {
        container.textContent = text;
        return;
      }

      let cursor = 0;
      ranges
        .filter((range) => Number.isInteger(range?.start) && Number.isInteger(range?.end))
        .map((range) => ({
          start: Math.max(0, Math.min(text.length, range.start)),
          end: Math.max(0, Math.min(text.length, range.end))
        }))
        .filter((range) => range.end > range.start)
        .sort((left, right) => left.start - right.start || left.end - right.end)
        .forEach((range) => {
          if (range.start < cursor) {
            return;
          }
          container.append(document.createTextNode(text.slice(cursor, range.start)));
          const mark = document.createElement("mark");
          mark.textContent = text.slice(range.start, range.end);
          container.append(mark);
          cursor = range.end;
        });

      container.append(document.createTextNode(text.slice(cursor)));
    }

    function buildExpandButton() {
      const expandButton = document.createElement("button");
      expandButton.type = "button";
      expandButton.className = "expand-toggle";
      expandButton.textContent = "⌄";
      expandButton.title = "اقرأ المزيد";
      expandButton.setAttribute("aria-label", "اقرأ المزيد");
      expandButton.setAttribute("aria-expanded", "false");
      expandButton.addEventListener("click", () => toggleEntryText(expandButton));
      return expandButton;
    }

    function toggleEntryText(expandButton) {
      const card = expandButton.closest(".entry-card");
      const textBlock = card ? card.querySelector(".entry-text") : null;

      if (!textBlock) {
        return;
      }

      const isExpanded = textBlock.classList.toggle("is-expanded");
      const label = isExpanded ? "إخفاء النص" : "اقرأ المزيد";
      expandButton.textContent = isExpanded ? "⌃" : "⌄";
      expandButton.title = label;
      expandButton.setAttribute("aria-label", label);
      expandButton.setAttribute("aria-expanded", String(isExpanded));
    }

    function buildImageContent(entry) {
      const wrapper = document.createElement("div");
      wrapper.className = "entry-content";

      const thumb = document.createElement("img");
      thumb.className = "entry-thumb";
      thumb.alt = "صورة محفوظة";
      thumb.draggable = false;
      thumb.loading = "lazy";
      thumb.decoding = "async";

      loadImageThumbnail(entry, thumb);

      wrapper.append(thumb);
      return wrapper;
    }

    async function loadImageThumbnail(entry, imgElement) {
      try {
        const blob = await getImageBlob(entry.image.blobKey);

        if (!blob) {
          return;
        }

        if (!imgElement.isConnected) {
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        activeImageObjectUrls.push(objectUrl);
        imgElement.dataset.objectUrl = objectUrl;
        imgElement.src = objectUrl;
      } catch (loadError) {
        imgElement.alt = "تعذر تحميل الصورة";
      }
    }

    function buildCardActions(entry, listName) {
      const actions = document.createElement("div");
      actions.className = "card-actions";

      const expandButton = entry.type === "text" ? buildExpandButton() : null;
      const copyButton = createIconButton("copy", "نسخ", () => copyEntryContent(entry));
      const pinButton = createIconButton(
        "pin",
        listName === "pinned" ? "إلغاء التثبيت" : "تثبيت",
        () => togglePin(entry.id),
        listName === "pinned" ? "is-pinned" : ""
      );
      const tagButton = createIconButton("tag", "تعديل الوسوم", () => editEntryTags(entry));
      const deleteButton = createIconButton("trash", "حذف", () => deleteEntry(listName, entry.id), "danger");

      if (expandButton) {
        actions.append(expandButton);
      }

      actions.append(copyButton, pinButton, tagButton, deleteButton);
      return actions;
    }

    function normalizeTags(tags) {
      if (!Array.isArray(tags)) {
        return [];
      }

      return [...new Set(tags.map((tag) => typeof tag === "string" ? tag.trim().slice(0, 30) : "")
        .filter((tag) => tag.length > 0))].slice(0, 20);
    }

    function editEntryTags(entry) {
      const currentTags = Array.isArray(entry.tags) ? entry.tags.join(", ") : "";
      const requestedTags = window.prompt("اكتب الوسوم مفصولة بفاصلة", currentTags);

      if (requestedTags === null) {
        return;
      }

      entry.tags = normalizeTags(requestedTags.split(","));
      commitState("تم تحديث الوسوم.");
    }

    async function copyText(text) {
      if (desktopApi) {
        try {
          await desktopApi.writeText(text);
          showToast("تم النسخ.");
          return true;
        } catch (desktopCopyError) {
          console.debug("النسخ الأصلي غير متاح، سيتم استخدام البديل.", desktopCopyError);
        }
      }

      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
          await navigator.clipboard.writeText(text);
          showToast("تم النسخ.");
          return true;
        }
      } catch (clipboardError) {
        console.debug("Clipboard API غير متاح، سيتم استخدام النسخ البديل.", clipboardError);
      }

      if (copyTextWithTextarea(text)) {
        showToast("تم النسخ.");
        return true;
      }

      showToast("تعذر النسخ تلقائيًا.", false);
      return false;
    }

    async function copyEntryContent(entry) {
      if (entry.type === "image") {
        return copyImageEntry(entry);
      }

      return copyText(entry.text);
    }

    async function copyImageEntry(entry) {
      try {
        const blob = await getImageBlob(entry.image.blobKey);

        if (!blob) {
          showToast("تعذر العثور على بيانات الصورة.", false);
          return false;
        }

        if (desktopApi) {
          await desktopApi.writeImage(await blobToDataUrl(blob));
          showToast("تم نسخ الصورة.");
          return true;
        }

        if (!navigator.clipboard || typeof navigator.clipboard.write !== "function" || typeof window.ClipboardItem !== "function") {
          showToast("نسخ الصور غير مدعوم في هذا المتصفح.", false);
          return false;
        }

        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        showToast("تم نسخ الصورة.");
        return true;
      } catch (copyError) {
        showToast("تعذر نسخ الصورة.", false);
        return false;
      }
    }

    function handleDrop(event) {
      event.preventDefault();
      document.body.classList.remove("is-dragging");

      if (elements.settingsDialog.open) {
        return;
      }

      if (!event.dataTransfer) {
        showToast("لم يتم العثور على محتوى قابل للإضافة.", false);
        return;
      }

      const files = event.dataTransfer.files;

      if (files && files.length > 0) {
        const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));

        if (imageFiles.length === 0) {
          showToast("هذا النوع من الملفات غير مدعوم؛ الصور فقط.", false);
          return;
        }

        imageFiles.forEach((file) => addImage(file, "normal"));
        return;
      }

      const droppedText = droppedPlainText(event.dataTransfer);
      addText(droppedText, "normal");
    }

    function handleEntryDragStart(event, entry) {
      if (!event.dataTransfer) {
        return;
      }

      event.currentTarget.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "copy";

      if (entry.type === "image") {
        if (desktopApi && typeof desktopApi.startImageDrag === "function") {
          event.preventDefault();
          desktopApi.startImageDrag(entry.image.blobKey);
          return;
        }

        const thumbElement = event.currentTarget.querySelector(".entry-thumb");
        const objectUrl = thumbElement && thumbElement.src ? thumbElement.src : "";

        if (objectUrl) {
          try {
            const extension = mimeTypeToExtension(entry.image.mimeType);
            event.dataTransfer.setData("DownloadURL", `${entry.image.mimeType}:image-${entry.id}${extension}:${objectUrl}`);
          } catch (dragError) {
            console.debug("DownloadURL غير متاح، سيتم استخدام رابط الصورة.", dragError);
          }

          event.dataTransfer.setData("text/uri-list", objectUrl);
        }

        return;
      }

      event.dataTransfer.setData("text/plain", entry.text);
    }

    function mimeTypeToExtension(mimeType) {
      const extensionMap = {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg",
        "image/bmp": ".bmp"
      };

      return extensionMap[mimeType] || "";
    }

    function escapeRegExp(literal) {
      return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function removeSeparatorBoundaryLineEnding(segment) {
      if (segment.endsWith("\r\n")) {
        return segment.slice(0, -2);
      }

      return segment.endsWith("\n") ? segment.slice(0, -1) : segment;
    }

    function splitClipboardBatch(text, separator) {
      const separatorLine = new RegExp(`^${escapeRegExp(separator)}(?:\\r\\n|\\n|$)`, "gm");
      const segments = [];
      let segmentStart = 0;

      for (const match of text.matchAll(separatorLine)) {
        const segment = removeSeparatorBoundaryLineEnding(text.slice(segmentStart, match.index));

        if (segment.length > 0) {
          segments.push(segment);
        }

        segmentStart = match.index + match[0].length;
      }

      const trailingSegment = text.slice(segmentStart);

      if (trailingSegment.length > 0) {
        segments.push(trailingSegment);
      }

      return segments;
    }

    function joinClipboardBatch(items, separator) {
      return items.filter((item) => typeof item === "string" && isNonEmptyText(item)).join(`\n${separator}\n`);
    }

    function addClipboardText(text, targetList, feedback = TEXT_FEEDBACK, clipboardMetadata = null) {
      const segments = splitClipboardBatch(text, state.settings.batchSeparator);

      if (segments.length === 0) {
        return false;
      }

      if (segments.length === 1) {
        return addText(segments[0], targetList, feedback, clipboardMetadata);
      }

      let addedCount = 0;
      segments.forEach((segment) => {
        if (addText(segment, targetList, null, clipboardMetadata)) {
          addedCount += 1;
        }
      });

      if (feedback) {
        showToast(`تمت إضافة ${addedCount} عناصر من الدفعة.`);
      }

      return addedCount > 0;
    }

    async function handleAutomaticClipboardEntry(clipboardPayload) {
      if (!desktopApi || !state.settings.autoCapture || state.settings.privacyMode || !clipboardPayload) {
        return;
      }

      if (clipboardPayload.kind === "image" && typeof clipboardPayload.dataUrl === "string") {
        await addImage(dataUrlToBlob(clipboardPayload.dataUrl), "normal", null, clipboardPayload);
        return;
      }

      if (clipboardPayload.kind === "text" && typeof clipboardPayload.text === "string") {
        addClipboardText(clipboardPayload.text, "normal", null, clipboardPayload);
      }
    }

    async function pasteFromClipboard() {
      if (desktopApi) {
        try {
          const clipboardPayload = await desktopApi.readClipboard();

          if (clipboardPayload && clipboardPayload.kind === "image" && typeof clipboardPayload.dataUrl === "string") {
            await addImage(dataUrlToBlob(clipboardPayload.dataUrl), "normal", undefined, clipboardPayload);
            return;
          }

          addClipboardText(
            clipboardPayload && typeof clipboardPayload.text === "string" ? clipboardPayload.text : "",
            "normal",
            undefined,
            clipboardPayload
          );
        } catch (desktopPasteError) {
          showToast("تعذر قراءة الحافظة من التطبيق.", false);
        }

        return;
      }

      if (!navigator.clipboard) {
        showToast("المتصفح لا يسمح بقراءة الحافظة هنا. جرّب السحب والإفلات.", false);
        return;
      }

      if (typeof navigator.clipboard.read === "function") {
        try {
          const clipboardItems = await navigator.clipboard.read();
          const foundImage = findClipboardImage(clipboardItems);

          if (foundImage) {
            const blob = await foundImage.clipboardItem.getType(foundImage.type);
            await addImage(blob, "normal");
            return;
          }
        } catch (readError) {
          console.debug("قراءة الصور من الحافظة غير متاحة، سيتم تجربة النص.", readError);
        }
      }

      if (typeof navigator.clipboard.readText !== "function") {
        showToast("المتصفح لا يسمح بقراءة الحافظة هنا. جرّب السحب والإفلات.", false);
        return;
      }

      try {
        const clipboardText = await navigator.clipboard.readText();
        addClipboardText(clipboardText, "normal");
      } catch (clipboardError) {
        showToast("تعذر قراءة الحافظة. تحقق من إذن الوصول لها.", false);
      }
    }

    function findClipboardImage(clipboardItems) {
      for (const clipboardItem of clipboardItems) {
        const imageType = clipboardItem.types.find((type) => type.startsWith("image/"));

        if (imageType) {
          return { clipboardItem, type: imageType };
        }
      }

      return null;
    }

    function applyTheme(theme) {
      const selectedTheme = theme === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = selectedTheme;
      elements.themeToggle.textContent = selectedTheme === "dark" ? "الوضع الفاتح" : "الوضع الداكن";
      elements.themeToggle.setAttribute(
        "aria-label",
        selectedTheme === "dark" ? "التبديل إلى الوضع الفاتح" : "التبديل إلى الوضع الداكن"
      );
    }

    function updateAutoCaptureToggle() {
      const isAvailable = Boolean(desktopApi);
      const isEnabled = isAvailable && state.settings.autoCapture;
      elements.autoCaptureToggle.disabled = !isAvailable;
      elements.autoCaptureToggle.classList.toggle("is-on", isEnabled);
      elements.autoCaptureToggle.setAttribute("aria-pressed", String(isEnabled));
      elements.autoCaptureToggle.textContent = isAvailable ? (isEnabled ? "مفعّل" : "متوقف") : "تطبيق فقط";
    }

    function updateGlobalShortcutToggle() {
      const isAvailable = Boolean(desktopApi);
      const isEnabled = isAvailable && state.settings.globalShortcutEnabled === true;
      elements.globalShortcutToggle.disabled = !isAvailable;
      elements.globalShortcutToggle.classList.toggle("is-on", isEnabled);
      elements.globalShortcutToggle.setAttribute("aria-pressed", String(isEnabled));
      elements.globalShortcutToggle.textContent = isAvailable ? (isEnabled ? "مفعّل" : "متوقف") : "تطبيق فقط";
      elements.globalShortcutInput.disabled = !isAvailable;
      elements.globalShortcutDefaultButton.disabled = !isAvailable;
      if (document.activeElement !== elements.globalShortcutInput) {
        elements.globalShortcutInput.value = state.settings.globalShortcutAccelerator;
      }
    }

    function updatePrivacyControls() {
      const isEnabled = state.settings.privacyMode === true;
      elements.privacyModeToggle.classList.toggle("is-on", isEnabled);
      elements.privacyModeToggle.setAttribute("aria-pressed", String(isEnabled));
      elements.privacyModeToggle.textContent = isEnabled ? "مفعّل" : "متوقف";

      if (document.activeElement !== elements.retentionDaysInput) {
        elements.retentionDaysInput.value = String(state.settings.retentionDays || 0);
      }
    }

    function toggleAutoCapture() {
      if (!desktopApi) {
        showToast("الالتقاط التلقائي متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      state.settings.autoCapture = !state.settings.autoCapture;
      commitState(state.settings.autoCapture ? "تم تشغيل الالتقاط التلقائي." : "تم إيقاف الالتقاط التلقائي.");
    }

    function togglePrivacyMode() {
      state.settings.privacyMode = state.settings.privacyMode !== true;
      commitState(state.settings.privacyMode ? "تم إيقاف الالتقاط بوضع الخصوصية." : "تم إيقاف وضع الخصوصية.");
    }

    function saveRetentionSetting() {
      const retentionDays = Number(elements.retentionDaysInput.value);

      if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 3650) {
        elements.retentionDaysInput.value = String(state.settings.retentionDays || 0);
        showToast("عدد الأيام يجب أن يكون بين 0 و3650.", false);
        return;
      }

      state.settings.retentionDays = retentionDays;
      commitState(retentionDays > 0 ? `سيتم الاحتفاظ بالعادي ${retentionDays} يومًا.` : "تم إلغاء الحذف التلقائي.");
      applyRetentionPolicy();
    }

    function applyRetentionPolicy() {
      const retentionOutcome = removeExpiredEntries(state.normal, Date.now(), state.settings.retentionDays);

      if (retentionOutcome.removed.length === 0) {
        return;
      }

      state.normal = retentionOutcome.kept;
      cleanupImageBlobs(retentionOutcome.removed);
      commitState(`تم حذف ${retentionOutcome.removed.length} عناصر منتهية.`);
    }

    async function toggleGlobalShortcut() {
      if (!desktopApi) {
        showToast("الاختصار العام متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      const requestedState = state.settings.globalShortcutEnabled !== true;

      try {
        const appliedState = await desktopApi.setGlobalShortcutEnabled(
          requestedState,
          state.settings.globalShortcutAccelerator
        );
        state.settings.globalShortcutEnabled = appliedState === true;
        commitState(
          state.settings.globalShortcutEnabled
            ? `تم تفعيل ${state.settings.globalShortcutAccelerator}.`
            : (requestedState ? "الاختصار مستخدم من برنامج آخر." : "تم إيقاف الاختصار العام.")
        );
      } catch (shortcutError) {
        showToast("تعذر تغيير الاختصار العام.", false);
      }
    }

    async function saveGlobalShortcutSetting() {
      const requestedAccelerator = window.ClipboardShelfAccelerator.normalizeGlobalShortcut(elements.globalShortcutInput.value);

      if (!validGlobalShortcut(requestedAccelerator)) {
        elements.globalShortcutInput.value = state.settings.globalShortcutAccelerator;
        showToast("اكتب الاختصار بصيغة مثل Ctrl+Shift+Space.", false);
        return;
      }

      const previousAccelerator = state.settings.globalShortcutAccelerator;
      if (requestedAccelerator === previousAccelerator) {
        return;
      }

      if (state.settings.globalShortcutEnabled === true && desktopApi) {
        try {
          const appliedState = await desktopApi.setGlobalShortcutEnabled(true, requestedAccelerator);
          if (!appliedState) {
            await desktopApi.setGlobalShortcutEnabled(true, previousAccelerator);
            elements.globalShortcutInput.value = previousAccelerator;
            showToast("الاختصار الجديد مستخدم من برنامج آخر.", false);
            return;
          }
        } catch (shortcutError) {
          try {
            await desktopApi.setGlobalShortcutEnabled(true, previousAccelerator);
          } catch (restoreError) {
            console.debug("تعذر استعادة الاختصار السابق.", restoreError);
          }
          elements.globalShortcutInput.value = previousAccelerator;
          showToast("تعذر تغيير الاختصار العام.", false);
          return;
        }
      }

      state.settings.globalShortcutAccelerator = requestedAccelerator;
      commitState("تم حفظ الاختصار العام.");
    }

    function restoreDefaultGlobalShortcut() {
      elements.globalShortcutInput.value = DEFAULT_GLOBAL_SHORTCUT;
      void saveGlobalShortcutSetting();
    }

    function saveBatchSeparatorSetting() {
      const separator = elements.batchSeparatorInput.value;

      if (!validBatchSeparator(separator)) {
        elements.batchSeparatorInput.value = state.settings.batchSeparator;
        showToast("الفاصل يجب أن يكون بين 3 و80 حرفًا وفي سطر واحد.", false);
        return;
      }

      state.settings.batchSeparator = separator;
      commitState("تم حفظ فاصل النسخ المتعدد.");
    }

    function updateAlwaysOnTopButton(enabled) {
      elements.alwaysOnTopButton.classList.toggle("is-active", enabled);
      elements.alwaysOnTopButton.setAttribute("aria-pressed", String(enabled));
      const label = enabled ? "إلغاء التثبيت فوق النوافذ" : "تثبيت فوق النوافذ";
      elements.alwaysOnTopButton.title = label;
      elements.alwaysOnTopButton.setAttribute("aria-label", label);
    }

    function setKeyboardLockButtonState(status) {
      const locked = Boolean(status && status.locked);
      elements.keyboardLockButton.disabled = false;
      elements.keyboardLockButton.classList.toggle("is-active", locked);
      elements.keyboardLockButton.setAttribute("aria-pressed", String(locked));
      const label = locked ? "إلغاء قفل لوحة المفاتيح" : "قفل لوحة المفاتيح";
      elements.keyboardLockButton.title = label;
      elements.keyboardLockButton.setAttribute("aria-label", label);
    }

    async function toggleKeyboardLock() {
      if (!desktopApi) {
        showToast("قفل لوحة المفاتيح متاح في تطبيق سطح المكتب على ويندوز فقط.", false);
        return;
      }

      const requestedLocked = elements.keyboardLockButton.getAttribute("aria-pressed") !== "true";
      elements.keyboardLockButton.disabled = true;

      try {
        const status = await desktopApi.setKeyboardLocked(requestedLocked);
        setKeyboardLockButtonState(status);

        if (status && status.mode === "error") {
          showToast("تعذر تفعيل قفل لوحة المفاتيح.", false);
        }
      } catch (keyboardLockError) {
        setKeyboardLockButtonState({ locked: false });
        showToast("تعذر تفعيل قفل لوحة المفاتيح.", false);
      }
    }

    function setColorPickerActive(active) {
      elements.colorPickerButton.disabled = active;
      elements.colorPickerButton.classList.toggle("is-active", active);
      elements.colorPickerButton.setAttribute("aria-pressed", String(active));
    }

    async function activateColorPicker() {
      if (!desktopApi) {
        showToast("قطّارة الألوان متاحة في تطبيق سطح المكتب فقط.", false);
        return;
      }

      setColorPickerActive(true);

      try {
        await desktopApi.startColorPicker();
      } catch (colorPickerError) {
        setColorPickerActive(false);
        showToast("تعذر بدء اختيار اللون من الشاشة.", false);
      }
    }

    async function transformSelectedText() {
      const entry = selectedEntries().find((candidate) => candidate.type === "text");
      if (!entry || !desktopApi?.transformText) {
        showToast("حدد كرتًا نصيًا؛ التحويل متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      const operation = window.prompt(
        "اختر التحويل:\nwhitespace-cleanup\nuppercase\nlowercase\nquotes-straighten\nquotes-smart\nbullets-to-numbered\nnumbered-to-bullets",
        "whitespace-cleanup"
      );
      if (!operation) return;

      try {
        const result = await desktopApi.transformText(entry.text, operation.trim(), { collapseSpaces: true });
        await copyText(result.text);
        showToast("تم نسخ النسخة المحوّلة، والأصل ما زال محفوظًا.");
      } catch {
        showToast("التحويل غير متاح أو اسم العملية غير صحيح.", false);
      }
    }

    async function analyzeSelectedImage() {
      const entry = selectedEntries().find((candidate) => candidate.type === "image");
      if (!entry || !desktopApi?.analyzeImage || !desktopApi?.readLibraryImage) {
        showToast("حدد كرت صورة؛ تحليل الصورة متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      try {
        const dataUrl = await desktopApi.readLibraryImage(entry.image.blobKey);
        const analysis = await desktopApi.analyzeImage(dataUrl);
        const lines = [];
        if (analysis.colors?.formats) {
          lines.push(analysis.colors.formats.hex, analysis.colors.formats.rgb, analysis.colors.formats.hsl);
        }
        if (Array.isArray(analysis.codes?.links)) lines.push(...analysis.codes.links);
        if (lines.length === 0) {
          showToast("لم يتوفر تحليل لوني أو كود لهذه الصورة.", false);
          return;
        }
        await copyText(lines.join("\n"));
        showToast(`تم نسخ تحليل الصورة (${lines.length} قيمة).`);
      } catch {
        showToast("تعذر تحليل الصورة؛ يدعم التحليل اللوني صور PNG محليًا.", false);
      }
    }

    function handlePickedColor(result) {
      setColorPickerActive(false);

      if (result && result.cancelled === true) {
        return;
      }

      if (result && typeof result.hex === "string") {
        try {
          const details = formatColorDetails(result);
          showToast(`تم نسخ اللون ${details.hex} — ${details.rgb} — ${details.hsl}.`);
        } catch {
          showToast(`تم نسخ اللون ${result.hex}.`);
        }
        return;
      }

      showToast("تعذر قراءة لون الشاشة.", false);
    }

    function setOcrPickerActive(active) {
      elements.ocrButton.disabled = active;
      elements.ocrButton.classList.toggle("is-active", active);
      elements.ocrButton.setAttribute("aria-pressed", String(active));
    }

    async function activateOcrPicker() {
      if (!desktopApi) {
        showToast("استخراج النص متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      setOcrPickerActive(true);

      try {
        await desktopApi.startOcrPicker();
      } catch (ocrStartError) {
        setOcrPickerActive(false);
        showToast("تعذر بدء تحديد النص من الشاشة.", false);
      }
    }

    function handleOcrResult(result) {
      setOcrPickerActive(false);

      if (result && result.cancelled === true) {
        return;
      }

      if (result && typeof result.text === "string" && result.text.trim()) {
        addText(result.text, "normal", null);
        showToast(Array.isArray(result.warnings) && result.warnings.includes("LOW_CONFIDENCE")
          ? "تم استخراج النص ونسخه، لكن الثقة منخفضة؛ راجعه قبل الاعتماد."
          : "تم استخراج النص ونسخه.");
        return;
      }

      showToast(result?.error || "تعذر استخراج النص من الجزء المحدد.", false);
    }

    async function initializeDesktopControls() {
      if (!desktopApi) {
        updateAutoCaptureToggle();
        return;
      }

      desktopApi.onClipboardChanged((clipboardPayload) => {
        if (!desktopStateLoaded) {
          return;
        }

        void handleAutomaticClipboardEntry(clipboardPayload);
      });
      desktopApi.onColorPicked(handlePickedColor);
      desktopApi.onOcrResult(handleOcrResult);
      desktopApi.onLibraryConflict(handleLibraryConflict);
      desktopApi.onQuickPaletteRequested(openQuickPalette);
      desktopApi.onKeyboardLockChanged((status) => setKeyboardLockButtonState(status));

      try {
        const alwaysOnTop = await desktopApi.getAlwaysOnTop();
        elements.windowControls.hidden = false;
        updateAlwaysOnTopButton(alwaysOnTop);
      } catch (desktopSetupError) {
        console.warn("تعذر تفعيل تحكم نافذة التطبيق.", desktopSetupError);
      }

      try {
        const keyboardLockStatus = await desktopApi.getKeyboardLockStatus();
        setKeyboardLockButtonState(keyboardLockStatus);
      } catch (keyboardLockStatusError) {
        console.warn("تعذر قراءة حالة قفل لوحة المفاتيح.", keyboardLockStatusError);
      }
    }

    async function initializeDesktopState() {
      if (!desktopApi) {
        return;
      }

      const legacyState = loadState();

      try {
        const libraryLoadResult = await desktopApi.loadLibrary();
        replaceStateFromStorage(
          libraryLoadResult && libraryLoadResult.exists ? libraryLoadResult.library : legacyState,
          libraryLoadResult && libraryLoadResult.exists
        );

        if (!libraryLoadResult || !libraryLoadResult.exists) {
          await migrateLegacyImages(state);
          await desktopApi.saveLibrary(stateWithDurableTrash(state));
        }

        desktopStateLoaded = true;
        applyTheme(state.settings.theme);
        render();
        applyRetentionPolicy();
        void desktopApi.cleanupLibraryMedia(stateWithDurableTrash(state)).catch(() => {
          showToast("تعذر فحص ملفات الصور القديمة.", false);
        });
        try {
          const appliedShortcut = await desktopApi.setGlobalShortcutEnabled(
            state.settings.globalShortcutEnabled === true,
            state.settings.globalShortcutAccelerator
          );

          if (appliedShortcut !== state.settings.globalShortcutEnabled) {
            state.settings.globalShortcutEnabled = appliedShortcut === true;
            commitState("الاختصار العام غير متاح حاليًا.", false);
          }
        } catch (shortcutError) {
          state.settings.globalShortcutEnabled = false;
          showToast("تعذر تفعيل الاختصار العام.", false);
        }
      } catch (desktopLoadError) {
        replaceStateFromStorage(legacyState);
        applyTheme(state.settings.theme);
        render();
        showToast("تعذر تحميل المكتبة المكتبية؛ تم استخدام النسخة المحلية الحالية.", false);
      }
    }

    async function migrateLegacyImages(library) {
      const imageEntries = [...library.pinned, ...library.normal].filter((entry) => entry.type === "image");

      for (const entry of imageEntries) {
        const blob = await getImageBlob(entry.image.blobKey);

        if (!blob) {
          throw new Error(`Missing legacy image ${entry.image.blobKey}`);
        }

        const storedImage = await desktopApi.writeLibraryImage(entry.image.blobKey, await blobToDataUrl(blob));

        if (storedImage && typeof storedImage === "object") {
          entry.image.blobKey = typeof storedImage.mediaKey === "string" ? storedImage.mediaKey : entry.image.blobKey;
          entry.image.hash = typeof storedImage.sha256 === "string" ? storedImage.sha256 : entry.image.hash;
          entry.image.size = typeof storedImage.size === "number" ? storedImage.size : entry.image.size;
          entry.image.mimeType = typeof storedImage.mimeType === "string" ? storedImage.mimeType : entry.image.mimeType;
        }
      }
    }

    async function toggleDesktopAlwaysOnTop() {
      const requestedState = elements.alwaysOnTopButton.getAttribute("aria-pressed") !== "true";

      try {
        const appliedState = await desktopApi.setAlwaysOnTop(requestedState);
        updateAlwaysOnTopButton(appliedState);
      } catch (alwaysOnTopError) {
        showToast("تعذر تغيير تثبيت النافذة.", false);
      }
    }

    function toggleTheme() {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      applyTheme(state.settings.theme);
      commitState(state.settings.theme === "dark" ? "تم تفعيل الوضع الداكن." : "تم تفعيل الوضع الفاتح.");
    }

    async function exportBackup() {
      try {
        const backupState = normalizeState(state);
        const pinned = await serializeEntriesForExport(backupState.pinned);
        const normal = await serializeEntriesForExport(backupState.normal);
        const backupPayload = {
          schemaVersion: SCHEMA_VERSION,
          settings: backupState.settings,
          pinned,
          normal,
          linkGroups: backupState.linkGroups
        };
        const backupBlob = new Blob([JSON.stringify(backupPayload, null, 2)], {
          type: "application/json"
        });
        const backupUrl = URL.createObjectURL(backupBlob);
        const downloadLink = document.createElement("a");
        downloadLink.href = backupUrl;
        downloadLink.download = `clipboard-shelf-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
        document.body.append(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        URL.revokeObjectURL(backupUrl);
        showToast("تم تجهيز ملف النسخة الاحتياطية.");
      } catch (exportError) {
        showToast("تعذر تصدير النسخة الاحتياطية.", false);
      }
    }

    async function restoreLatestLocalBackup() {
      if (!desktopApi) {
        showToast("النسخ المحلية التلقائية متاحة في تطبيق سطح المكتب فقط.", false);
        return;
      }

      try {
        const backups = await desktopApi.listLibraryBackups();

        if (!Array.isArray(backups) || backups.length === 0) {
          showToast("لا توجد نسخة محلية تلقائية بعد.", false);
          return;
        }

        if (!window.confirm("استعادة آخر نسخة محلية ستستبدل الحالة الحالية. هل تريد المتابعة؟")) {
          return;
        }

        replaceStateFromStorage(await desktopApi.restoreLibraryBackup(backups[0]), true);
        applyTheme(state.settings.theme);
        render();
        showToast("تمت استعادة آخر نسخة محلية.");
      } catch (restoreError) {
        showToast("تعذر استعادة النسخة المحلية.", false);
      }
    }

    async function createMarkdownSnapshot() {
      if (!desktopApi) {
        showToast("نسخ Markdown متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      try {
        const snapshot = await desktopApi.createLibrarySnapshot(stateWithDurableTrash(state));
        showToast(`تم حفظ نسخة Markdown (${snapshot.itemCount} عنصر).`);
      } catch (snapshotError) {
        showToast("تعذر حفظ نسخة Markdown؛ راجع صحة الصور والبيانات.", false);
      }
    }

    async function verifyMarkdownSnapshot() {
      if (!desktopApi) {
        showToast("فحص نسخ Markdown متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      try {
        const snapshots = await desktopApi.listLibrarySnapshots();

        if (!Array.isArray(snapshots) || snapshots.length === 0) {
          showToast("لا توجد نسخة Markdown لفحصها.", false);
          return;
        }

        const result = await desktopApi.verifyLibrarySnapshot(snapshots[0]);
        showToast(result.valid ? "آخر نسخة Markdown سليمة." : "فشل فحص آخر نسخة Markdown.", result.valid);
      } catch (verifyError) {
        showToast("تعذر فحص نسخة Markdown.", false);
      }
    }

    async function reloadMarkdown() {
      if (!desktopApi) {
        showToast("إعادة تحميل Markdown متاحة في تطبيق سطح المكتب فقط.", false);
        return;
      }

      try {
        const libraryLoadResult = await desktopApi.loadLibrary();

        if (!libraryLoadResult || !libraryLoadResult.exists) {
          showToast("لا توجد مكتبة Markdown محفوظة بعد.", false);
          return;
        }

        replaceStateFromStorage(libraryLoadResult.library, true);
        clearSelection();
        applyTheme(state.settings.theme);
        render();
        showToast("تمت إعادة تحميل مكتبة Markdown.");
      } catch (reloadError) {
        showToast("تعذر إعادة تحميل مكتبة Markdown.", false);
      }
    }

    async function openMarkdownDirectory() {
      if (!desktopApi) {
        showToast("مجلد Markdown متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      try {
        const result = await desktopApi.openMarkdownDirectory();
        showToast(result?.opened ? "تم فتح مجلد Markdown." : "تعذر فتح مجلد Markdown.", result?.opened === true);
      } catch (openError) {
        showToast("تعذر فتح مجلد Markdown.", false);
      }
    }

    async function inspectStorageHealth() {
      if (!desktopApi) {
        showToast("فحص التخزين متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      try {
        const report = await desktopApi.getLibraryHealth(normalizeState(state));
        const warningCount = report.orphanMedia + report.brokenReferences + report.pendingTransactions;
        showToast(warningCount === 0
          ? `التخزين سليم: ${report.mediaFiles} صورة و${report.backups} نسخة.`
          : `فحص التخزين: ${warningCount} ملاحظة تحتاج مراجعة.`, warningCount === 0);
      } catch (healthError) {
        showToast("تعذر فحص التخزين المحلي.", false);
      }
    }

    async function inspectAppHealth() {
      if (!desktopApi || typeof desktopApi.getAppHealth !== "function") {
        showToast("تشخيص التطبيق متاح في نسخة سطح المكتب فقط.", false);
        return;
      }

      try {
        const report = await desktopApi.getAppHealth();
        const warningCount = report?.storage?.brokenReferences + report?.storage?.orphanMedia
          + report?.storage?.pendingTransactions;
        showToast(warningCount === 0
          ? `التطبيق سليم — الإصدار ${report.appVersion}.`
          : `تشخيص التطبيق: ${warningCount} ملاحظة تحتاج مراجعة.`, warningCount === 0);
      } catch (healthError) {
        showToast("تعذر جمع تشخيص التطبيق المحلي.", false);
      }
    }

    async function readVersionHistory() {
      if (!desktopApi) {
        showToast("سجل الإصدارات متاح في تطبيق سطح المكتب فقط.", false);
        return null;
      }

      try {
        const history = await desktopApi.listVersionHistory();
        return Array.isArray(history) ? history : [];
      } catch (historyError) {
        showToast("تعذر قراءة سجل الإصدارات.", false);
        return null;
      }
    }

    async function listVersionHistory() {
      const history = await readVersionHistory();
      if (!history) {
        return;
      }

      if (history.length === 0) {
        showToast("لا توجد إصدارات محفوظة بعد.");
        return;
      }

      window.alert(formatVersionHistory(history));
    }

    async function restoreVersionHistory() {
      const history = await readVersionHistory();
      if (!history) {
        return;
      }
      if (history.length === 0) {
        showToast("لا توجد إصدارات محفوظة بعد.", false);
        return;
      }

      const selectedSummary = chooseVersionHistorySummary(history);
      if (!selectedSummary) {
        return;
      }

      try {
        await desktopApi.restoreVersionHistory(selectedSummary.id);
        await reloadDesktopState();
        showToast("تمت استعادة الإصدار.");
      } catch (restoreHistoryError) {
        showToast("تعذر استعادة الإصدار المحدد.", false);
      }
    }

    function formatVersionHistory(history) {
      return history.map((summary, index) => `${index + 1}. ${summary.id}`).join("\n");
    }

    function chooseVersionHistorySummary(history) {
      const requestedNumber = Number(window.prompt(`اختر رقم الإصدار:\n${formatVersionHistory(history)}`));
      const selectedSummary = Number.isSafeInteger(requestedNumber) ? history[requestedNumber - 1] : null;
      return selectedSummary && window.confirm(`استعادة الإصدار ${selectedSummary.id}؟`) ? selectedSummary : null;
    }

    async function reloadDesktopState() {
      const libraryLoadResult = await desktopApi.loadLibrary();
      replaceStateFromStorage(libraryLoadResult.library, true);
      clearSelection();
      applyTheme(state.settings.theme);
      render();
    }

    async function rebuildOcrIndex() {
      if (!desktopApi) {
        showToast("فهرس OCR متاح في تطبيق سطح المكتب فقط.", false);
        return;
      }

      try {
        const report = await desktopApi.rebuildOcrIndex(stateWithDurableTrash(state));
        showToast(report?.enabled === false ? "فهرس OCR غير متاح." : `تمت إعادة بناء فهرس OCR: ${report.count} عنصر.`);
      } catch (rebuildError) {
        showToast("تعذر إعادة بناء فهرس OCR.", false);
      }
    }

    function handleLibraryConflict(change) {
      const count = Array.isArray(change?.paths) ? change.paths.length : 1;
      showToast(`تم تعديل ${count} من ملفات Markdown خارج التطبيق. راجع الملف ثم اضغط إعادة تحميل.`, false);
    }

    async function serializeEntriesForExport(entries) {
      const serialized = [];

      for (const entry of entries) {
        if (entry.type === "image") {
          const blob = await getImageBlob(entry.image.blobKey);

          if (!blob) {
            continue;
          }

          const dataUrl = await blobToDataUrl(blob);
          serialized.push({
            id: entry.id,
            type: "image",
            image: {
              mimeType: entry.image.mimeType,
              size: entry.image.size,
              hash: entry.image.hash,
              dataUrl
            },
            tags: normalizeTags(entry.tags),
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt
          });
        } else {
          serialized.push(copyEntry(entry));
        }
      }

      return serialized;
    }

    async function importBackup(file) {
      if (!file) {
        return;
      }

      const previousState = normalizeState(state);

      try {
        const fileText = await readImportText(file);
        const parsedRaw = JSON.parse(fileText);
        const preparedIncoming = await prepareImportedState(parsedRaw);
        mergeImportedState(preparedIncoming);
        showToast("تم استيراد النسخة ودمجها بدون تكرار.");
      } catch (importError) {
        state = appStateStore.replaceState(previousState);
        saveState(state);
        render();
        showToast("فشل الاستيراد: تأكد أن الملف نسخة JSON صالحة.", false);
      } finally {
        elements.importInput.value = "";
      }
    }

    async function readImportText(file) {
      if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_IMPORT_BYTES) {
        throw new Error("Backup file is too large");
      }

      if (typeof file.stream !== "function") {
        return file.text();
      }

      const reader = file.stream().getReader();
      const decoder = new TextDecoder();
      const chunks = [];
      let bytesRead = 0;

      try {
        while (true) {
          const result = await reader.read();

          if (result.done) {
            break;
          }

          bytesRead += result.value.byteLength;
          if (bytesRead > MAX_IMPORT_BYTES) {
            await reader.cancel();
            throw new Error("Backup file is too large");
          }

          chunks.push(decoder.decode(result.value, { stream: true }));
        }

        chunks.push(decoder.decode());
        return chunks.join("");
      } finally {
        reader.releaseLock();
      }
    }

    async function prepareImportedState(raw) {
      if (!raw || typeof raw !== "object" || ![1, SCHEMA_VERSION].includes(raw.schemaVersion)) {
        throw new Error("Unsupported backup");
      }

      if (!Array.isArray(raw.pinned) || !Array.isArray(raw.normal)) {
        throw new Error("Malformed backup");
      }

      assertImportEntries(raw.pinned);
      assertImportEntries(raw.normal);

      const writtenBlobKeys = [];

      try {
        const pinned = await resolveImportedEntries(raw.pinned, writtenBlobKeys);
        const normal = await resolveImportedEntries(raw.normal, writtenBlobKeys);
        const theme = raw.settings && raw.settings.theme === "dark" ? "dark" : "light";
        const batchSeparator = validBatchSeparator(raw.settings && raw.settings.batchSeparator)
          ? raw.settings.batchSeparator
          : DEFAULT_BATCH_SEPARATOR;
        const globalShortcutEnabled = raw.settings?.globalShortcutEnabled === true;
        const globalShortcutAccelerator = window.ClipboardShelfAccelerator.normalizeGlobalShortcut(raw.settings?.globalShortcutAccelerator)
          || DEFAULT_GLOBAL_SHORTCUT;
        const privacyMode = raw.settings?.privacyMode === true;
        const retentionDays = Number.isInteger(raw.settings?.retentionDays) && raw.settings.retentionDays >= 0
          ? Math.min(raw.settings.retentionDays, 3650)
          : 0;

        return normalizeState({
          schemaVersion: SCHEMA_VERSION,
          settings: {
            theme,
            duplicatePolicy: "dedupe-move-to-top",
            normalLimit: NORMAL_LIMIT,
            batchSeparator,
            globalShortcutEnabled,
            globalShortcutAccelerator,
            privacyMode,
            retentionDays
          },
          pinned,
          normal,
          linkGroups: raw.linkGroups,
          smartCollections: raw.smartCollections,
          trash: raw.trash
        });
      } catch (resolveError) {
        await Promise.all(writtenBlobKeys.map((key) => deleteImageBlob(key)));
        throw resolveError;
      }
    }

    async function resolveImportedEntries(entries, writtenBlobKeys) {
      const resolved = [];

      for (const entry of entries) {
        if (entry.type === "image") {
          const blob = dataUrlToBlob(entry.image.dataUrl);
          const arrayBuffer = await blob.arrayBuffer();
          const hash = hashArrayBuffer(arrayBuffer);
          const blobKey = createEntryId(validTimestamp(entry.updatedAt) ? entry.updatedAt : Date.now());
          let storedBlobKey = blobKey;
          let storedHash = hash;
          let storedSize = blob.size;
          let storedMimeType = blob.type || entry.image.mimeType;

          if (desktopApi) {
            const storedImage = await desktopApi.writeLibraryImage(blobKey, await blobToDataUrl(blob));

            if (storedImage && typeof storedImage === "object") {
              storedBlobKey = typeof storedImage.mediaKey === "string" ? storedImage.mediaKey : blobKey;
              storedHash = typeof storedImage.sha256 === "string" ? storedImage.sha256 : hash;
              storedSize = typeof storedImage.size === "number" ? storedImage.size : storedSize;
              storedMimeType = typeof storedImage.mimeType === "string" ? storedImage.mimeType : storedMimeType;
            }
          } else {
            await putImageBlob(blobKey, blob);
          }
          writtenBlobKeys.push(storedBlobKey);
          resolved.push({
            id: entry.id,
            type: "image",
            image: { blobKey: storedBlobKey, mimeType: storedMimeType, size: storedSize, hash: storedHash },
            tags: normalizeTags(entry.tags),
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt
          });
        } else {
          resolved.push(entry);
        }
      }

      return resolved;
    }

    function assertImportEntries(entries) {
      const hasMalformedEntry = entries.some((entry) => {
        if (
          !entry
          || typeof entry !== "object"
          || typeof entry.id !== "string"
          || entry.id.length === 0
          || !validTimestamp(entry.createdAt)
          || !validTimestamp(entry.updatedAt)
        ) {
          return true;
        }

        if (entry.type === "image") {
          return !entry.image
            || typeof entry.image !== "object"
            || typeof entry.image.mimeType !== "string"
            || !entry.image.mimeType.startsWith("image/")
            || typeof entry.image.dataUrl !== "string"
            || !entry.image.dataUrl.startsWith("data:image/");
        }

        return !isNonEmptyText(entry.text);
      });

      if (hasMalformedEntry) {
        throw new Error("Malformed backup entry");
      }
    }

    function mergeImportedState(incoming) {
      const mergedState = normalizeState(state);
      state = appStateStore.replaceState(mergedState);

      incoming.pinned.forEach((entry) => {
        mergeImportedEntry("pinned", entry);
      });
      incoming.normal.forEach((entry) => {
        mergeImportedEntry("normal", entry);
      });

      incoming.linkGroups.forEach((group) => {
        const existingGroup = state.linkGroups.find((candidate) => candidate.name === group.name);

        if (existingGroup) {
          const mergedItems = dedupeSavedItems([...getSavedGroupItems(existingGroup), ...getSavedGroupItems(group)]);
          delete existingGroup.links;
          existingGroup.items = mergedItems;
          existingGroup.updatedAt = Date.now();
        } else {
          state.linkGroups.push(group);
        }
      });

      enforceNormalLimit();
      commitState("");
    }

    function normalizeEntries(entries) {
      if (!Array.isArray(entries)) {
        return [];
      }

      const seenSignatures = new Set();
      const normalizedEntries = [];

      entries.forEach((raw) => {
        const entry = normalizeSingleEntry(raw);

        if (!entry) {
          return;
        }

        const signature = entrySignature(entry);

        if (seenSignatures.has(signature)) {
          return;
        }

        seenSignatures.add(signature);
        normalizedEntries.push(entry);
      });

      return normalizedEntries.sort((leftEntry, rightEntry) => rightEntry.updatedAt - leftEntry.updatedAt);
    }

    function normalizeSingleEntry(raw) {
      if (!raw || typeof raw !== "object") {
        return null;
      }

      const createdAt = validTimestamp(raw.createdAt) ? raw.createdAt : Date.now();
      const updatedAt = validTimestamp(raw.updatedAt) ? raw.updatedAt : createdAt;
      const id = typeof raw.id === "string" && raw.id ? raw.id : createEntryId(updatedAt);

      if (raw.type === "image") {
        if (!isValidImageMeta(raw.image)) {
          return null;
        }

        return {
          id,
          type: "image",
          image: {
            blobKey: raw.image.blobKey,
            mimeType: raw.image.mimeType,
            size: raw.image.size,
            hash: raw.image.hash
          },
          tags: normalizeTags(raw.tags),
          createdAt,
          updatedAt,
          ...normalizeClipboardMetadata(raw)
        };
      }

      if (!isNonEmptyText(raw.text)) {
        return null;
      }

      return {
        id,
        type: "text",
        text: raw.text,
        tags: normalizeTags(raw.tags),
        createdAt,
        updatedAt,
        ...normalizeClipboardMetadata(raw)
      };
    }

    function isValidImageMeta(image) {
      return Boolean(
        image
        && typeof image === "object"
        && typeof image.blobKey === "string"
        && image.blobKey.length > 0
        && typeof image.mimeType === "string"
        && image.mimeType.startsWith("image/")
        && typeof image.size === "number"
        && image.size >= 0
        && typeof image.hash === "string"
        && image.hash.length > 0
      );
    }

    function mergeImportedEntry(listName, entry) {
      const signature = entrySignature(entry);
      const existingMatch = findEntryBySignature(signature);

      if (existingMatch && existingMatch.listName === "pinned") {
        moveEntryToTop("pinned", existingMatch.entry.id);
        discardOrphanBlob(entry);
        return;
      }

      if (listName === "pinned") {
        if (existingMatch) {
          const removed = removeEntryById(existingMatch.listName, existingMatch.entry.id);
          cleanupImageBlobs(removed ? [removed] : []);
        }

        state.pinned.unshift(copyEntry(entry));
        return;
      }

      if (existingMatch) {
        moveEntryToTop(existingMatch.listName, existingMatch.entry.id);
        discardOrphanBlob(entry);
        return;
      }

      state.normal.unshift(copyEntry(entry));
    }

    function discardOrphanBlob(entry) {
      if (entry.type === "image") {
        deleteImageBlob(entry.image.blobKey);
      }
    }

    function cleanupImageBlobs(entries) {
      entries
        .filter((entry) => entry.type === "image")
        .forEach((entry) => {
          const blobKey = entry.image.blobKey;
          if (!hasLiveImageReference(blobKey)) {
            void deleteImageBlob(blobKey);
          }
        });
    }

    function restoreDeletedEntry(listName, entry) {
      const existingMatch = findEntryBySignature(entrySignature(entry));

      if (existingMatch) {
        moveEntryToTop(existingMatch.listName, existingMatch.entry.id);
        return;
      }

      state[listName].unshift(copyEntry(entry));
    }

    function hasLiveImageReference(blobKey, ignoredRecordIds = new Set()) {
      if (typeof blobKey !== "string" || !blobKey) {
        return false;
      }

      const activeLists = [state.pinned, state.normal];
      if (activeLists.some((entries) => entries.some((entry) => entry.type === "image" && entry.image.blobKey === blobKey))) {
        return true;
      }

      return trashStore.list().some((record) => (
        !ignoredRecordIds.has(record.id)
        && record.entry.type === "image"
        && record.entry.image.blobKey === blobKey
      ));
    }

    function restoreTrashRecord(recordId) {
      const restored = trashStore.restore(recordId);
      if (!restored) {
        return null;
      }

      restoreDeletedEntry(restored.listName, restored.entry);
      enforceNormalLimit();
      commitState("");
      return restored.entry;
    }

    function purgeTrashRecord(recordId) {
      const record = trashStore.get(recordId);
      if (!record) {
        return 0;
      }

      const blobKey = record.entry.type === "image" ? record.entry.image.blobKey : "";
      const purgedCount = trashStore.purge(recordId);
      if (purgedCount === 0) {
        return 0;
      }

      commitState("");
      if (blobKey && !hasLiveImageReference(blobKey, new Set([recordId]))) {
        void deleteImageBlob(blobKey);
      }
      return purgedCount;
    }

    function purgeAllTrash() {
      const records = trashStore.list();
      if (records.length === 0) {
        return 0;
      }

      const imageBlobKeys = [...new Set(records
        .filter((record) => record.entry.type === "image")
        .map((record) => record.entry.image.blobKey))];
      const purgedCount = trashStore.purge();
      if (purgedCount === 0) {
        return 0;
      }

      commitState("");
      imageBlobKeys.forEach((blobKey) => {
        if (!hasLiveImageReference(blobKey)) {
          void deleteImageBlob(blobKey);
        }
      });
      return purgedCount;
    }

    function moveEntryToTop(listName, id) {
      const movedEntry = removeEntryById(listName, id);

      if (!movedEntry) {
        return;
      }

      movedEntry.updatedAt = Date.now();
      state[listName].unshift(movedEntry);
    }

    function removeEntryById(listName, id) {
      const entryIndex = state[listName].findIndex((entry) => entry.id === id);

      if (entryIndex < 0) {
        return null;
      }

      return state[listName].splice(entryIndex, 1)[0];
    }

    function commitState(message, canUndo) {
      state = appStateStore.replaceState(normalizeState(state));
      enforceNormalLimit();
      reconcileSelection();
      saveState(state);
      render();

      if (message) {
        showToast(message, true, canUndo);
      }
    }

    function setUndoRecord(undoRecord) {
      if (undoTimer) {
        window.clearTimeout(undoTimer);
        undoTimer = null;
      }

      lastUndo = undoRecord;
      undoTimer = window.setTimeout(() => {
        lastUndo = null;
        undoTimer = null;
      }, UNDO_WINDOW_MS);
    }

    function clearUndoTimer() {
      if (undoTimer) {
        window.clearTimeout(undoTimer);
        undoTimer = null;
      }
    }

    function showToast(message, isSuccess, canUndo) {
      if (toastTimer) {
        window.clearTimeout(toastTimer);
      }

      const toast = document.createElement("div");
      toast.className = "toast";
      toast.setAttribute("role", isSuccess === false ? "alert" : "status");

      const messageText = document.createElement("span");
      messageText.textContent = message;
      toast.append(messageText);

      if (canUndo) {
        const undoButton = document.createElement("button");
        undoButton.type = "button";
        undoButton.className = "toast-action";
        undoButton.textContent = "تراجع";
        undoButton.title = "التراجع عن الحذف";
        undoButton.setAttribute("aria-label", "التراجع عن الحذف");
        undoButton.addEventListener("click", undoLastDeletion);
        toast.append(undoButton);
      }

      elements.toastRegion.replaceChildren(toast);
      accessibilityAnnouncer.announce(message);
      toastTimer = window.setTimeout(() => {
        elements.toastRegion.replaceChildren();
        toastTimer = null;
      }, canUndo ? UNDO_WINDOW_MS : 3600);
    }

    function createIconButton(iconName, label, onClick, extraClass) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "icon-btn" + (extraClass ? ` ${extraClass}` : "");
      button.append(createIconMarkup(iconName));
      button.title = label;
      button.setAttribute("aria-label", label);
      button.addEventListener("click", onClick);
      return button;
    }

    function createIconMarkup(iconName) {
      const svg = document.createElementNS(SVG_NAMESPACE, "svg");
      svg.setAttribute("class", "icon");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const definition = ICON_DEFINITIONS[iconName] || ICON_DEFINITIONS.copy;

      definition.forEach(({ name, attributes }) => {
        const iconElement = document.createElementNS(SVG_NAMESPACE, name);
        Object.entries(attributes).forEach(([attributeName, attributeValue]) => {
          iconElement.setAttribute(attributeName, attributeValue);
        });
        svg.append(iconElement);
      });

      return svg;
    }

    function droppedPlainText(dataTransfer) {
      const textPayload = dataTransfer.getData("text/plain");

      if (textPayload) {
        return textPayload;
      }

      const uriPayload = dataTransfer.getData("text/uri-list");

      if (!uriPayload) {
        return "";
      }

      return uriPayload
        .split(/\r?\n/)
        .find((line) => line && !line.startsWith("#")) || "";
    }

    function copyTextWithTextarea(text) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.inset = "0 auto auto 0";
      textarea.style.width = "1px";
      textarea.style.height = "1px";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();

      let didCopy = false;

      try {
        didCopy = document.execCommand("copy");
      } catch (copyError) {
        didCopy = false;
      }

      textarea.remove();
      return didCopy;
    }

    function isNonEmptyText(candidateText) {
      return typeof candidateText === "string" && candidateText.trim().length > 0;
    }

    function validTimestamp(timestamp) {
      return typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp >= 0;
    }

    function copyEntry(entry) {
      const base = {
        id: entry.id,
        type: entry.type === "image" ? "image" : "text",
        tags: normalizeTags(entry.tags),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        ...normalizeClipboardMetadata(entry)
      };

      if (base.type === "image") {
        base.image = {
          blobKey: entry.image.blobKey,
          mimeType: entry.image.mimeType,
          size: entry.image.size,
          hash: entry.image.hash
        };
      } else {
        base.text = entry.text;
      }

      return base;
    }

    function cloneEntries(entries) {
      return entries.map(copyEntry);
    }

    function createEntryId(timestamp) {
      const randomPart = Math.random().toString(36).slice(2, 10);
      return `entry-${timestamp}-${randomPart}`;
    }

    function getEntryFromCard(card) {
      if (!card) {
        return null;
      }

      const listName = card.dataset.listName;
      const id = card.dataset.entryId;
      const list = state[listName];

      return list ? list.find((entry) => entry.id === id) || null : null;
    }

    function openImageDb() {
      if (imageDbPromise) {
        return imageDbPromise;
      }

      imageDbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error("IndexedDB unavailable"));
          return;
        }

        const request = indexedDB.open(IMAGE_DB_NAME, 1);

        request.onupgradeneeded = () => {
          request.result.createObjectStore(IMAGE_STORE_NAME);
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
      });

      return imageDbPromise;
    }

    async function putImageBlob(key, blob) {
      const db = await openImageDb();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(IMAGE_STORE_NAME, "readwrite");
        transaction.objectStore(IMAGE_STORE_NAME).put(blob, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }

    async function getImageBlob(key) {
      if (desktopApi) {
        try {
          const dataUrl = await desktopApi.readLibraryImage(key);

          if (dataUrl) {
            return dataUrlToBlob(dataUrl);
          }
        } catch (desktopImageError) {
          console.debug("تعذر قراءة الصورة من التخزين المكتبي.", desktopImageError);
        }
      }

      const db = await openImageDb();

      return new Promise((resolve, reject) => {
        const transaction = db.transaction(IMAGE_STORE_NAME, "readonly");
        const request = transaction.objectStore(IMAGE_STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    async function deleteImageBlob(key) {
      if (desktopApi) {
        try {
          await desktopApi.deleteLibraryImage(key);
        } catch (desktopDeleteError) {
          console.debug("تعذر حذف الصورة من التخزين المكتبي.", desktopDeleteError);
        }
      }

      try {
        const db = await openImageDb();

        await new Promise((resolve, reject) => {
          const transaction = db.transaction(IMAGE_STORE_NAME, "readwrite");
          transaction.objectStore(IMAGE_STORE_NAME).delete(key);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
        });
      } catch (dbError) {
        console.warn("تعذر تنظيف بيانات صورة محلية.", dbError);
      }
    }

    function hashArrayBuffer(arrayBuffer) {
      const bytes = new Uint8Array(arrayBuffer);
      let hash = 0x811c9dc5;

      for (let i = 0; i < bytes.length; i++) {
        hash ^= bytes[i];
        hash = Math.imul(hash, 0x01000193);
      }

      return (hash >>> 0).toString(16);
    }

    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error || new Error("Failed to read blob"));
        reader.readAsDataURL(blob);
      });
    }

    function dataUrlToBlob(dataUrl) {
      const commaIndex = dataUrl.indexOf(",");
      const header = dataUrl.slice(0, commaIndex);
      const base64Data = dataUrl.slice(commaIndex + 1);
      const mimeMatch = /data:([^;]+);base64/.exec(header);
      const mimeType = mimeMatch ? mimeMatch[1] : "application/octet-stream";
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);

      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      return new Blob([bytes], { type: mimeType });
    }

    function releaseCardImage(card) {
      const image = card.querySelector(".entry-thumb");
      const objectUrl = image?.dataset.objectUrl;

      if (!objectUrl) {
        return;
      }

      URL.revokeObjectURL(objectUrl);
      delete image.dataset.objectUrl;
      activeImageObjectUrls = activeImageObjectUrls.filter((url) => url !== objectUrl);
    }

    function handleGlobalKeydown(event) {
      if (quickPaletteOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeQuickPalette();
        }
        return;
      }

      if (event.key === "Escape") {
        if (toolsMenuOpen) {
          setToolsMenu(false);
        } else if (elements.inspectorDialog.open) {
          closeEntryInspector();
        } else if (elements.linkGroupDialog.open) {
          elements.linkGroupDialog.close();
        } else if (linkDrawerOpen) {
          setLinkDrawer(false);
        } else if (selectedCardKeys.size > 0) {
          clearSelection();
        }
        return;
      }

      const isModifierPressed = event.ctrlKey || event.metaKey;

      if (!isModifierPressed) {
        return;
      }

      const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
      const isPasteShortcut = event.code === "KeyV" || key === "v";
      const isCopyShortcut = event.code === "KeyC" || key === "c";

      if (isPasteShortcut) {
        event.preventDefault();
        pasteFromClipboard();
        return;
      }

      if (isCopyShortcut) {
        if (selectedCardKeys.size > 0) {
          event.preventDefault();
          void copySelectedAsBatch();
          return;
        }

        const focusedCard = document.activeElement && document.activeElement.closest
          ? document.activeElement.closest(".entry-card")
          : null;
        const focusedEntry = getEntryFromCard(focusedCard);

        if (focusedEntry) {
          event.preventDefault();
          copyEntryContent(focusedEntry);
        }
      }
    }

    function activatePageFromClick(event) {
      const clickedElement = event.target instanceof Element ? event.target : null;
      const clickedInteractiveElement = clickedElement && clickedElement.closest(
        "button, input, select, textarea, a, dialog, .entry-card, [contenteditable=\"true\"]"
      );

      if (!clickedInteractiveElement) {
        document.body.focus({ preventScroll: true });
      }
    }

    function isDialogClickOutsideContent(event, dialog) {
      const rect = dialog.getBoundingClientRect();
      return (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      );
    }

    document.addEventListener("dragenter", (event) => {
      if (elements.settingsDialog.open) {
        return;
      }

      event.preventDefault();
      document.body.classList.add("is-dragging");
    });

    document.addEventListener("dragover", (event) => {
      if (elements.settingsDialog.open) {
        return;
      }

      event.preventDefault();

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
    });

    document.addEventListener("dragleave", (event) => {
      if (!event.relatedTarget) {
        document.body.classList.remove("is-dragging");
      }
    });

    document.addEventListener("drop", handleDrop);

    elements.quickPalette.addEventListener("click", (event) => {
      if (event.target === elements.quickPalette) {
        closeQuickPalette();
      }
    });
    elements.quickPaletteInput.addEventListener("input", () => {
      ensureQuickPalette().setQuery(elements.quickPaletteInput.value);
      renderQuickPalette();
    });
    elements.quickPaletteInput.addEventListener("keydown", (event) => {
      void handleQuickPaletteKeydown(event);
    });
    elements.closeQuickPaletteButton.addEventListener("click", closeQuickPalette);
    elements.keyboardLockButton.addEventListener("click", () => void toggleKeyboardLock());
    elements.colorPickerButton.addEventListener("click", () => void activateColorPicker());
    elements.ocrButton.addEventListener("click", () => void activateOcrPicker());
    elements.toolsMenuButton.addEventListener("click", () => setToolsMenu(!toolsMenuOpen));
    elements.overflowColorPickerButton.addEventListener("click", () => {
      setToolsMenu(false);
      void activateColorPicker();
    });
    elements.overflowOcrButton.addEventListener("click", () => {
      setToolsMenu(false);
      void activateOcrPicker();
    });
    elements.overflowLinkMenuButton.addEventListener("click", () => {
      setToolsMenu(false);
      setLinkDrawer(!linkDrawerOpen);
    });
    elements.overflowSearchButton.addEventListener("click", () => {
      setToolsMenu(false);
      setSearchPanel(!searchPanelOpen);
    });
    elements.overflowTransformButton.addEventListener("click", () => {
      setToolsMenu(false);
      void transformSelectedText();
    });
    elements.overflowAnalyzeImageButton.addEventListener("click", () => {
      setToolsMenu(false);
      void analyzeSelectedImage();
    });
    elements.linkMenuButton.addEventListener("click", () => setLinkDrawer(!linkDrawerOpen));
    elements.closeLinkDrawerButton.addEventListener("click", () => setLinkDrawer(false));
    elements.drawerBackdrop.addEventListener("click", () => setLinkDrawer(false));
    elements.toggleLinkDrawerSizeButton.addEventListener("click", () => setLinkDrawerCompact(!linkDrawerCompact));
    elements.newSmartCollectionButton.addEventListener("click", createSmartCollectionFromFilters);
    elements.clearActiveCollectionButton.addEventListener("click", clearActiveSmartCollection);
    elements.newLinkGroupButton.addEventListener("click", () => openLinkGroupEditor());
    elements.purgeAllTrashButton.addEventListener("click", () => {
      if (trashStore.list().length === 0 || !window.confirm("حذف كل المحذوفات نهائيًا؟ لا يمكن التراجع عن ذلك.")) {
        return;
      }
      const purgedCount = purgeAllTrash();
      if (purgedCount > 0) {
        showToast(`تم حذف ${purgedCount} عنصر نهائيًا.`);
      }
    });
    elements.linkGroupForm.addEventListener("submit", saveLinkGroupFromForm);
    elements.groupIconPicker.addEventListener("click", selectGroupIcon);
    elements.closeLinkGroupDialogButton.addEventListener("click", () => elements.linkGroupDialog.close());
    elements.cancelLinkGroupButton.addEventListener("click", () => elements.linkGroupDialog.close());
    elements.inspectorDialog.addEventListener("close", closeEntryInspector);
    elements.saveSelectionButton.addEventListener("click", createGroupFromSelection);
    elements.copySelectionButton.addEventListener("click", () => void copySelectedAsBatch());
    elements.clearSelectionButton.addEventListener("click", clearSelection);
    elements.toggleSelectionPinsButton.addEventListener("click", toggleSelectedPins);
    elements.tagSelectionButton.addEventListener("click", tagSelectedEntries);
    elements.deleteSelectionButton.addEventListener("click", deleteSelectedEntries);

    elements.searchToggleButton.addEventListener("click", () => setSearchPanel(!searchPanelOpen));
    elements.searchInput.addEventListener("input", () => {
      activeSmartCollectionId = null;
      state = appStateStore.dispatch({
        type: "search/set-query",
        query: elements.searchInput.value
      });
      render();
      saveSearchQuerySoon();
    });
    elements.searchType.addEventListener("change", () => {
      activeSmartCollectionId = null;
      searchType = elements.searchType.value;
      render();
    });
    elements.searchTag.addEventListener("change", () => {
      activeSmartCollectionId = null;
      searchTag = elements.searchTag.value;
      render();
    });
    elements.searchSource.addEventListener("input", () => {
      activeSmartCollectionId = null;
      searchSource = elements.searchSource.value.trim();
      render();
    });
    elements.searchDateFrom.addEventListener("change", () => {
      activeSmartCollectionId = null;
      searchDateFrom = elements.searchDateFrom.value;
      render();
    });
    elements.searchDateTo.addEventListener("change", () => {
      activeSmartCollectionId = null;
      searchDateTo = elements.searchDateTo.value;
      render();
    });
    wireSettings(elements, {
      openDialog: () => elements.settingsDialog.showModal(),
      closeDialogFromBackdrop: (event) => {
        if (event.target === elements.settingsDialog && isDialogClickOutsideContent(event, elements.settingsDialog)) {
          elements.settingsDialog.close();
        }
      },
      toggleTheme,
      toggleAutoCapture,
      toggleGlobalShortcut: () => void toggleGlobalShortcut(),
      saveGlobalShortcutSetting: () => void saveGlobalShortcutSetting(),
      restoreDefaultGlobalShortcut,
      togglePrivacyMode,
      saveRetentionSetting,
      saveBatchSeparatorSetting,
      openLinkGroupManager: () => {
        elements.settingsDialog.close();
        setLinkDrawer(true);
      },
      exportBackup,
      chooseImportFile: () => elements.importInput.click(),
      restoreLocalBackup: () => void restoreLatestLocalBackup(),
      createMarkdownSnapshot: () => void createMarkdownSnapshot(),
      verifyMarkdownSnapshot: () => void verifyMarkdownSnapshot(),
      reloadMarkdown: () => void reloadMarkdown(),
      openMarkdownDirectory: () => void openMarkdownDirectory(),
       inspectStorageHealth: () => void inspectStorageHealth(),
       inspectAppHealth: () => void inspectAppHealth(),
       listVersionHistory: () => void listVersionHistory(),
       restoreVersionHistory: () => void restoreVersionHistory(),
       rebuildOcrIndex: () => void rebuildOcrIndex(),
       importSelectedBackup: () => importBackup(elements.importInput.files[0]),
      clearNormalEntries: clearNormalWithUndo
    });

    if (desktopApi) {
      elements.alwaysOnTopButton.addEventListener("click", toggleDesktopAlwaysOnTop);
      elements.minimizeButton.addEventListener("click", () => desktopApi.minimizeWindow());
      elements.closeButton.addEventListener("click", () => desktopApi.closeWindow());
      void initializeDesktopControls();
      void initializeDesktopState();
    } else {
      replaceStateFromStorage(loadState());
      applyTheme(state.settings.theme);
      render();
    }

    new ToolbarController().mount(document.documentElement);
    document.addEventListener("click", activatePageFromClick);
    document.addEventListener("click", (event) => {
      if (toolsMenuOpen && event.target instanceof Element && !event.target.closest("#toolsMenu, #toolsMenuButton")) {
        setToolsMenu(false);
      }
    });
    document.addEventListener("keydown", handleGlobalKeydown);
