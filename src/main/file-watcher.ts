import * as fs from 'fs';
import type { BrowserWindow } from 'electron';

const DEBOUNCE_MS = 500;

interface WatchEntry {
  watcher: fs.FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
  refCount: number;
}

const watched = new Map<string, WatchEntry>();
let currentWin: BrowserWindow | null = null;

function notify(filePath: string): void {
  const entry = watched.get(filePath);
  if (!entry) return;
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('fs:fileChanged', filePath);
    }
  }, DEBOUNCE_MS);
}

export function setFileWatcherWindow(win: BrowserWindow): void {
  currentWin = win;
}

/** Expects an already-resolved absolute path. */
export function watchFile(filePath: string): void {
  const existing = watched.get(filePath);
  if (existing) {
    existing.refCount++;
    return;
  }

  try {
    const watcher = fs.watch(filePath, () => notify(filePath));
    watcher.on('error', () => {});
    watched.set(filePath, { watcher, timer: null, refCount: 1 });
  } catch {
    // File doesn't exist or can't be watched — ignore
  }
}

/** Expects an already-resolved absolute path. */
export function unwatchFile(filePath: string): void {
  const entry = watched.get(filePath);
  if (!entry) return;

  entry.refCount--;
  if (entry.refCount <= 0) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
    watched.delete(filePath);
  }
}

export function stopAllFileWatchers(): void {
  for (const entry of watched.values()) {
    if (entry.timer) clearTimeout(entry.timer);
    entry.watcher.close();
  }
  watched.clear();
  currentWin = null;
}
