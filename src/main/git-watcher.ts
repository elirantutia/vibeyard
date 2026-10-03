import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import type { BrowserWindow } from 'electron';
import { isLinux } from './platform';

const DEBOUNCE_MS = 300;
const MAX_WATCHES = 2000;

const IGNORE_SEGMENTS = new Set([
  '.git', 'node_modules', 'dist', 'build', '.next', '.cache', 'coverage', '__pycache__',
  '.venv', 'venv', 'env',
  '.tox', '.mypy_cache', '.ruff_cache', '.pytest_cache',
  'target', 'vendor', 'out',
  '.turbo', '.parcel-cache', '.svelte-kit', '.nuxt', '.output',
  '.idea', '.vscode',
  'tmp', '.tmp',
]);

const GIT_DIR_FILES = new Set(['index', 'HEAD', 'ORIG_HEAD', 'MERGE_HEAD', 'packed-refs', 'FETCH_HEAD']);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let dirWatchers: fs.FSWatcher[] = [];
let currentProjectPath: string | null = null;
let currentWin: BrowserWindow | null = null;
// Bumped on every start/stop so a call that is still awaiting setupWatchers
// can tell, when it resumes, that a newer call (or a stop) superseded it.
let watcherGeneration = 0;

function notify(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    if (currentWin && !currentWin.isDestroyed()) {
      currentWin.webContents.send('git:changed');
    }
  }, DEBOUNCE_MS);
}

function isIgnored(name: string): boolean {
  return IGNORE_SEGMENTS.has(name);
}

/** True if any segment of a watched-root-relative path is an ignored dir. */
function hasIgnoredSegment(filename: string): boolean {
  return filename.split(path.sep).some(isIgnored);
}

/**
 * Watch the whole working tree with a single recursive watch (macOS + Windows
 * only — Linux uses walkAndWatch). One FSEvents stream / ReadDirectoryChangesW
 * handle covers the entire tree, so project-switch teardown closes ~1 handle
 * instead of up to MAX_WATCHES — avoiding the synchronous FSEvents
 * re-registration storm that froze the UI (#142). `.git` is in IGNORE_SEGMENTS,
 * so git internals are filtered out here and handled by the fine-grained `.git`
 * watches in setupWatchers instead.
 */
function watchRecursiveWorkingTree(root: string, sink: fs.FSWatcher[]): void {
  try {
    const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
      // filename is relative to root (incl. subpath) or null when the OS
      // coalesces events — notify conservatively when we can't classify it.
      if (!filename || !hasIgnoredSegment(filename)) notify();
    });
    watcher.on('error', () => {}); // ignore (dir deleted, etc.)
    sink.push(watcher);
  } catch {
    // Recursive watch unavailable/failed — fall back to per-dir BFS so we still
    // get some signal (the 60s git-status poll is the ultimate backstop).
    walkAndWatch(root, sink);
  }
}

function watchOne(dirPath: string, onEvent: (filename: string | null) => void, sink: fs.FSWatcher[]): void {
  if (dirWatchers.length + sink.length >= MAX_WATCHES) return;
  try {
    const watcher = fs.watch(dirPath, (_event, filename) => {
      onEvent(filename);
    });
    watcher.on('error', () => {}); // ignore errors (dir deleted, etc.)
    sink.push(watcher);
  } catch {
    // Directory doesn't exist or unreadable — that's fine
  }
}

function walkAndWatch(root: string, sink: fs.FSWatcher[]): void {
  // BFS so we watch shallower dirs first; if we hit the cap, deep dirs are skipped
  // rather than dropping the more useful top-level signals.
  const queue: string[] = [root];
  let capWarned = false;
  while (queue.length > 0) {
    if (dirWatchers.length + sink.length >= MAX_WATCHES) {
      if (!capWarned) {
        console.warn(
          `[git-watcher] reached MAX_WATCHES=${MAX_WATCHES} for ${root}; remaining subdirs will not be watched (60s poll will cover them)`
        );
        capWarned = true;
      }
      break;
    }
    const dir = queue.shift()!;
    watchOne(dir, () => notify(), sink);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // EACCES, ENOENT — skip
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;
      if (isIgnored(entry.name)) continue;
      queue.push(path.join(dir, entry.name));
    }
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

async function setupWatchers(projectPath: string): Promise<fs.FSWatcher[]> {
  const sink: fs.FSWatcher[] = [];
  const gitDir = await resolveGitDir(projectPath);

  // Working tree. macOS + Windows support a single recursive watch (one OS-level
  // handle), which keeps project-switch teardown cheap (#142). Linux does not
  // support recursive fs.watch (and the old recursive path leaked inotify
  // watches, #139), so it keeps the walk-time-filtered, non-recursive, capped BFS.
  if (isLinux) {
    walkAndWatch(projectPath, sink);
  } else {
    watchRecursiveWorkingTree(projectPath, sink);
  }

  // Git internals: non-recursive watch on .git/ itself, only react to a small allow-list
  // of files (index/HEAD/ORIG_HEAD/MERGE_HEAD/packed-refs/FETCH_HEAD). This catches
  // stage/unstage, commit, branch switch, merge/rebase, fetch — without recursing into
  // .git/objects/ which is huge and produces no useful UI signal.
  watchOne(gitDir, (filename) => {
    if (filename && GIT_DIR_FILES.has(filename)) notify();
  }, sink);

  // Refs: non-recursive watch on each top-level refs subdirectory. Triggers on any
  // ref change within. We accept that ref churn inside a single remote is debounced
  // at the parent — that's fine for UI status.
  for (const sub of ['heads', 'tags', 'remotes']) {
    const refsSubdir = path.join(gitDir, 'refs', sub);
    watchOne(refsSubdir, () => notify(), sink);
  }

  // HEAD file directly: belt-and-suspenders for branch-switch detection on macOS
  // where FSEvents can report null filenames that the .git/ allow-list discards.
  const headPath = path.join(gitDir, 'HEAD');
  try {
    const watcher = fs.watch(headPath, () => notify());
    watcher.on('error', () => {});
    sink.push(watcher);
  } catch {
    // HEAD doesn't exist (unlikely for a valid git repo)
  }
  return sink;
}

export async function startGitWatcher(win: BrowserWindow, projectPath: string): Promise<void> {
  if (projectPath === currentProjectPath) return;
  const generation = ++watcherGeneration;
  stopAll();
  currentWin = win;
  currentProjectPath = projectPath;
  const mine = await setupWatchers(projectPath);
  if (generation !== watcherGeneration) {
    // A newer call (or stop) started while we were awaiting. Its stopAll() ran
    // before our watchers were installed, so close only ours — a blanket
    // stopAll() here could kill the newer call's watchers if they were
    // installed first. The latest call's state (currentProjectPath/currentWin)
    // stands.
    for (const w of mine) w.close();
  } else {
    dirWatchers.push(...mine);
  }
}

export function stopGitWatcher(): void {
  ++watcherGeneration; // invalidate any in-flight startGitWatcher
  stopAll();
  currentWin = null;
  currentProjectPath = null;
}

/** Trigger an immediate notification — call after stage/unstage/discard */
export function notifyGitChanged(): void {
  notify();
}
