import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import type { BrowserWindow } from 'electron';
import { resolveGitCommand, getGitWorktrees } from './git-status';
import { joinStoredProjectPath, projectRootForFsWatch, storedPathToMainFs } from './project-fs-path';

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
  const g = resolveGitCommand(projectPath);
  return new Promise((resolve) => {
    execFile(g.bin, [...g.prefixArgs, 'rev-parse', '--git-dir'], { cwd: g.execCwd, timeout: 3000 }, (err, stdout) => {
      if (err) {
        resolve(joinStoredProjectPath(projectPath, '.git'));
        return;
      }
      const raw = stdout.trim().replace(/\\/g, '/');
      const root = projectPath.replace(/\\/g, '/');
      const gitDir = path.posix.isAbsolute(raw) ? raw : path.posix.join(root, raw);
      resolve(storedPathToMainFs(gitDir));
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

  // Watch every linked worktree working tree (main checkout + `git worktree add` paths)
  const worktrees = await getGitWorktrees(projectPath);
  const watchedRoots = new Set<string>();
  for (const wt of worktrees) {
    if (wt.isBare) continue;
    const fsRoot = projectRootForFsWatch(wt.path);
    if (watchedRoots.has(fsRoot)) continue;
    watchedRoots.add(fsRoot);
    watchDir(fsRoot, shouldIgnore);
  }
  if (watchedRoots.size === 0) {
    watchDir(projectRootForFsWatch(projectPath), shouldIgnore);
  }

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
