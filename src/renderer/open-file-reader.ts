import { appState } from './state.js';
import { resolveProjectFilePath } from './state/specialized-sessions.js';

/**
 * Open a path in a file-reader tab, but only once the path is known to be an
 * openable file. `projectId` must be the active project — a row rendered for a
 * project the user has since left is dropped rather than opened.
 *
 * Checking first is load-bearing, not defensive: `addFileReaderSession` appends
 * the new tab and makes it active *before* anything touches the filesystem, so
 * a dead path spawns a tab that `loadFile`'s `closeSessionIfFileMissing` tears
 * down a moment later — and `removeSession` then falls back to the left
 * neighbour by index, not to the tab the user came from. The user sees a tab
 * flash and lands somewhere arbitrary.
 *
 * `exists` is also true for a directory, whose read fails with EISDIR; that tab
 * is never reaped (the path really is there) and sticks around permanently
 * showing "Failed to load file".
 *
 * Failures are console-only, matching every other silent-open path in the
 * renderer — and this never rejects, so callers can fire it off with a bare
 * `void` instead of each repeating the same `.catch`.
 */
export async function openFileReaderChecked(
  projectId: string,
  filePath: string,
  lineNumber?: number,
): Promise<void> {
  const project = appState.activeProject;
  if (project?.id !== projectId) {
    console.warn(`[open-file] ${projectId} is not the active project: ${filePath}`);
    return;
  }

  const fullPath = resolveProjectFilePath(project, filePath);

  try {
    const [exists, isDir] = await Promise.all([
      window.vibeyard.fs.exists(fullPath),
      window.vibeyard.fs.isDirectory(fullPath),
    ]);
    if (!exists || isDir) {
      console.warn(`[open-file] not an openable file: ${fullPath}`);
      return;
    }
  } catch (err: unknown) {
    // An invoke rejects when the window is tearing down mid-click.
    console.warn(`[open-file] could not check ${fullPath}`, err);
    return;
  }

  // Re-check after the await: the user may have switched projects while the IPC
  // was in flight, and appending to the one they left would silently steal its
  // tab selection.
  if (appState.activeProject?.id !== projectId) {
    console.warn(`[open-file] active project changed mid-lookup, dropping ${fullPath}`);
    return;
  }

  appState.addFileReaderSession(projectId, fullPath, lineNumber);
}
