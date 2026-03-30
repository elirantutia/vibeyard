import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import type { BrowserWindow } from 'electron';

const DEBOUNCE_MS = 300;
const IGNORE_SEGMENTS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.cache', 'coverage', '__pycache__']);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let dirWatchers: fs.FSWatcher[] = [];
let currentProjectPath: string | null = null;
let currentWin: BrowserWindow | null = null;

function notify(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('git:changed');
    }
  }, DEBOUNCE_MS);
}

function shouldIgnore(filename: string | null): boolean {
  if (!filename) return false;
  const first = filename.split(path.sep)[0];
  return IGNORE_SEGMENTS.has(first);
}

function watchDir(dirPath: string, shouldSkip?: (filename: string | null) => boolean): void {
  try {
    const watcher = fs.watch(dirPath, { recursive: true }, (_event, filename) => {
      if (shouldSkip && shouldSkip(filename)) return;
      notify();
    });
    watcher.on('error', () => {}); // ignore errors (dir deleted, etc.)
    dirWatchers.push(watcher);
  } catch {
    // Directory doesn't exist — that's fine
  }
}

function resolveGitDir(projectPath: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--git-dir'], { cwd: projectPath, timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(path.join(projectPath, '.git'));
        return;
      }
      const gitDir = stdout.trim();
      // Could be absolute or relative
      resolve(path.isAbsolute(gitDir) ? gitDir : path.join(projectPath, gitDir));
    });
  });
}

function stopAll(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  for (const w of dirWatchers) w.close();
  dirWatchers = [];
}

const GIT_DIR_FILES = new Set(['index', 'HEAD']);

async function setupWatchers(projectPath: string): Promise<void> {
  const gitDir = await resolveGitDir(projectPath);

  // Watch git dir for index changes (stage/unstage) and HEAD (branch switch, commit)
  watchDir(gitDir, (filename) => !filename || !GIT_DIR_FILES.has(filename));

  // Watch refs for commits, branch creation/deletion, remote updates
  watchDir(path.join(gitDir, 'refs'));

  // Watch working tree for file edits, filtering out ignored directories
  watchDir(projectPath, shouldIgnore);

  // Watch HEAD file directly for reliable branch-switch detection.
  // The recursive .git/ watcher may miss HEAD changes when macOS FSEvents
  // reports null filenames, which the shouldSkip filter discards.
  const headPath = path.join(gitDir, 'HEAD');
  try {
    const watcher = fs.watch(headPath, () => notify());
    watcher.on('error', () => {});
    dirWatchers.push(watcher);
  } catch {
    // HEAD doesn't exist (unlikely for a valid git repo)
  }
}

export async function startGitWatcher(win: BrowserWindow, projectPath: string): Promise<void> {
  if (projectPath === currentProjectPath) return;
  stopAll();
  currentWin = win;
  currentProjectPath = projectPath;
  await setupWatchers(projectPath);
}

export function stopGitWatcher(): void {
  stopAll();
  currentWin = null;
  currentProjectPath = null;
}

/** Trigger an immediate notification — call after stage/unstage/discard */
export function notifyGitChanged(): void {
  notify();
}
