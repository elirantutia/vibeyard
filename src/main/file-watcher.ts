import * as path from 'path';
import { FSWatcher } from 'chokidar';
import type { BrowserWindow } from 'electron';
import type { FsChange, FsChangeType } from '../shared/types';

// Snappier than the old 500ms — live agent edits should feel near-instant — while
// still coalescing the burst from a tool writing many files into one renderer flush.
const DEBOUNCE_MS = 150;

/**
 * Directory-granular file watcher backed by a single chokidar instance.
 *
 * We watch *directories* (non-recursively, `depth: 0`) rather than individual
 * file inodes. Watching the parent dir survives atomic save/replace (write-temp
 * + rename), which silently kills a watch on the old inode — the bug the inode
 * approach suffered from. Consumers that care about a single file watch its
 * parent dir and filter incoming changes by path.
 *
 * Directories are ref-counted so multiple consumers (the file tree, an open
 * reader, an open viewer) can share one underlying watch.
 */

const refCounts = new Map<string, number>();
let watcher: FSWatcher | null = null;
let currentWin: BrowserWindow | null = null;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
// Keyed by `${type}:${path}` so distinct events on the same path within a window
// are preserved, while duplicate events collapse.
const pending = new Map<string, FsChange>();

function flush(): void {
  debounceTimer = null;
  if (pending.size === 0) return;
  const changes = [...pending.values()];
  pending.clear();
  if (currentWin && !currentWin.isDestroyed()) {
    currentWin.webContents.send('fs:changed', changes);
  }
}

function queueChange(type: FsChangeType, fullPath: string): void {
  pending.set(`${type}:${fullPath}`, { path: fullPath, dir: path.dirname(fullPath), type });
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flush, DEBOUNCE_MS);
}

function ensureWatcher(): FSWatcher {
  if (watcher) return watcher;
  const w = new FSWatcher({
    ignoreInitial: true, // don't replay existing entries when a dir is added
    depth: 0, // non-recursive: each added dir reports only its immediate children
    atomic: true, // collapse write-temp + rename into a single change event
    ignorePermissionErrors: true,
    persistent: true,
  });
  const events: FsChangeType[] = ['add', 'addDir', 'change', 'unlink', 'unlinkDir'];
  for (const ev of events) {
    w.on(ev, (p: string) => queueChange(ev, p));
  }
  w.on('error', () => {}); // dir deleted / unreadable — handled via parent's unlinkDir
  watcher = w;
  return w;
}

export function setFileWatcherWindow(win: BrowserWindow): void {
  currentWin = win;
}

/** Watch a directory's immediate children. Expects an already-resolved absolute path. */
export function watchDir(dir: string): void {
  const cur = refCounts.get(dir) ?? 0;
  refCounts.set(dir, cur + 1);
  if (cur === 0) ensureWatcher().add(dir);
}

/** Drop a reference to a watched directory; closes the watch when the last ref goes. */
export function unwatchDir(dir: string): void {
  const cur = refCounts.get(dir);
  if (!cur) return;
  if (cur <= 1) {
    refCounts.delete(dir);
    watcher?.unwatch(dir);
  } else {
    refCounts.set(dir, cur - 1);
  }
}

export function stopAllFileWatchers(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pending.clear();
  refCounts.clear();
  if (watcher) {
    void watcher.close();
    watcher = null;
  }
  currentWin = null;
}
