const SETTINGS_BINDINGS = [
  ["settingsButton", "click", "openDialog"],
  ["settingsDialog", "click", "closeDialogFromBackdrop"],
  ["themeToggle", "click", "toggleTheme"],
  ["autoCaptureToggle", "click", "toggleAutoCapture"],
  ["globalShortcutToggle", "click", "toggleGlobalShortcut"],
  ["globalShortcutInput", "change", "saveGlobalShortcutSetting"],
  ["globalShortcutDefaultButton", "click", "restoreDefaultGlobalShortcut"],
  ["privacyModeToggle", "click", "togglePrivacyMode"],
  ["retentionDaysInput", "change", "saveRetentionSetting"],
  ["batchSeparatorInput", "change", "saveBatchSeparatorSetting"],
  ["manageLinkGroupsButton", "click", "openLinkGroupManager"],
  ["exportButton", "click", "exportBackup"],
  ["importButton", "click", "chooseImportFile"],
  ["restoreLocalBackupButton", "click", "restoreLocalBackup"],
  ["createMarkdownSnapshotButton", "click", "createMarkdownSnapshot"],
  ["verifyMarkdownSnapshotButton", "click", "verifyMarkdownSnapshot"],
  ["reloadMarkdownButton", "click", "reloadMarkdown"],
  ["openMarkdownDirectoryButton", "click", "openMarkdownDirectory"],
  ["storageHealthButton", "click", "inspectStorageHealth"],
  ["appHealthButton", "click", "inspectAppHealth"],
  ["listVersionHistoryButton", "click", "listVersionHistory"],
  ["restoreVersionHistoryButton", "click", "restoreVersionHistory"],
  ["rebuildOcrIndexButton", "click", "rebuildOcrIndex"],
  ["importInput", "change", "importSelectedBackup"],
  ["clearNormalButton", "click", "clearNormalEntries"]
];

export function wireSettings(elements, handlers) {
  SETTINGS_BINDINGS.forEach(([elementName, eventName, handlerName]) => {
    elements[elementName].addEventListener(eventName, handlers[handlerName]);
  });
}
