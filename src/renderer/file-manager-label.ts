// Per-OS i18n key for a "open in the OS file manager" label, so the text
// reads naturally (Explorer on Windows, Finder on macOS, File Manager elsewhere).
// Shared by the sidebar Files button and the file-tree context menus.
export function fileManagerLabelKey(): string {
  if (/win/i.test(navigator.platform)) return 'contextMenu.files.openInExplorer';
  if (/mac/i.test(navigator.platform)) return 'contextMenu.files.openInFinder';
  return 'contextMenu.files.openInFileManager';
}

/** i18n key for "open the containing folder in the OS file manager". */
export function openFolderLabelKey(): string {
  if (/win/i.test(navigator.platform)) return 'contextMenu.files.openFolderInExplorer';
  if (/mac/i.test(navigator.platform)) return 'contextMenu.files.openFolderInFinder';
  return 'contextMenu.files.openFolderInFileManager';
}
