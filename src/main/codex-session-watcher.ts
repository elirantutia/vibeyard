import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { BrowserWindow } from 'electron';
import { readFileSafe } from './fs-utils';
import { STATUS_DIR } from './hook-status';

const HISTORY_PATH = path.join(os.homedir(), '.codex', 'history.jsonl');

// Keep the history fallback for sessions that don't report a CLI ID via
// hooks. Titles come from Codex's separate session index.

// Maps UI session ID → registration timestamp (for FIFO ordering)
const pendingSessions = new Map<string, number>();
const assignedCodexIds = new Set<string>();

interface TitleSession {
  indexPath: string;
  resumeId: string | null;
  lastPayload?: string;
}

interface TitleIndex {
  stat: fs.Stats;
  names: Map<string, string>;
}

const titleSessions = new Map<string, TitleSession>();
const titleIndexes = new Map<string, TitleIndex>();

let watcher: fs.FSWatcher | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastSize = 0;

function readNewEntries(): void {
  if (pendingSessions.size === 0) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(HISTORY_PATH);
  } catch {
    return;
  }

  if (stat.size <= lastSize) return;

  let fd: number | null = null;
  try {
    fd = fs.openSync(HISTORY_PATH, 'r');
    const buf = Buffer.alloc(stat.size - lastSize);
    fs.readSync(fd, buf, 0, buf.length, lastSize);
    lastSize = stat.size;

    const lines = buf.toString('utf-8').trim().split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        const codexSessionId: string | undefined = entry.session_id;
        if (!codexSessionId || assignedCodexIds.has(codexSessionId)) continue;

        // Assign to the oldest pending UI session
        let oldestId: string | null = null;
        let oldestTime = Infinity;
        for (const [uiId, addedAt] of pendingSessions) {
          if (addedAt < oldestTime) {
            oldestTime = addedAt;
            oldestId = uiId;
          }
        }

        if (oldestId) {
          assignedCodexIds.add(codexSessionId);
          pendingSessions.delete(oldestId);

          fs.mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
          fs.writeFileSync(
            path.join(STATUS_DIR, `${oldestId}.sessionid`),
            codexSessionId
          );
          break;
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // File read error
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

export function registerPendingCodexSession(sessionId: string): void {
  // Only advance lastSize when first session registers, so we don't skip
  // entries that arrived between multiple rapid registrations
  if (pendingSessions.size === 0) {
    try {
      const stat = fs.statSync(HISTORY_PATH);
      lastSize = stat.size;
    } catch {
      lastSize = 0;
    }
  }

  pendingSessions.set(sessionId, Date.now());
}

export function unregisterCodexSession(sessionId: string): void {
  pendingSessions.delete(sessionId);
}

/** Track the Codex home actually passed to this PTY, including project overrides. */
export function trackCodexSessionTitle(
  sessionId: string, resumeId: string | null, cwd: string, codexHome?: string,
): () => void {
  const home = codexHome ? path.resolve(cwd, codexHome) : path.dirname(HISTORY_PATH);
  const session: TitleSession = { indexPath: path.join(home, 'session_index.jsonl'), resumeId };
  titleSessions.set(sessionId, session);
  return () => {
    if (titleSessions.get(sessionId) === session) titleSessions.delete(sessionId);
  };
}

function readTitleIndex(indexPath: string): TitleIndex | undefined {
  try {
    const stat = fs.statSync(indexPath);
    if (!stat.isFile()) return undefined;
    const cached = titleIndexes.get(indexPath);
    if (cached && stat.ino === cached.stat.ino && stat.size === cached.stat.size &&
        stat.mtimeMs === cached.stat.mtimeMs && stat.ctimeMs === cached.stat.ctimeMs) return cached;

    const names = new Map<string, string>();
    // Codex appends a row on rename. Later valid rows supersede earlier names
    // for the same thread, including when Codex rewrites the index.
    for (const line of fs.readFileSync(indexPath, 'utf8').split('\n')) {
      try {
        const entry = JSON.parse(line);
        if (typeof entry?.id === 'string' && typeof entry?.thread_name === 'string') {
          names.set(entry.id, entry.thread_name.trim());
        }
      } catch {
        // Skip blank, malformed or partially written rows.
      }
    }
    const index = { stat, names };
    titleIndexes.set(indexPath, index);
    return index;
  } catch {
    // Older Codex installs may have no title index. Retry on the next poll.
    titleIndexes.delete(indexPath);
    return undefined;
  }
}

function syncSessionTitles(): void {
  const activeIndexes = new Map<string, TitleIndex | undefined>();
  for (const [sessionId, session] of titleSessions) {
    if (!activeIndexes.has(session.indexPath)) {
      activeIndexes.set(session.indexPath, readTitleIndex(session.indexPath));
    }
    const index = activeIndexes.get(session.indexPath);
    if (!index) continue;
    const cliSessionId = readFileSafe(path.join(STATUS_DIR, `${sessionId}.sessionid`))?.trim() || session.resumeId;
    const name = cliSessionId && index.names.get(cliSessionId);
    if (!name) continue;

    const payload = JSON.stringify({ name, session_id: cliSessionId });
    if (payload === session.lastPayload) continue;
    try {
      fs.writeFileSync(path.join(STATUS_DIR, `${sessionId}.name`), payload, { mode: 0o600 });
      session.lastPayload = payload;
    } catch {
      // The status directory may be re-created when the window reopens.
    }
  }
  for (const indexPath of titleIndexes.keys()) {
    if (!activeIndexes.has(indexPath)) titleIndexes.delete(indexPath);
  }
}

export function startCodexSessionWatcher(win: BrowserWindow): void {
  if (pollInterval) return;

  const dir = path.dirname(HISTORY_PATH);
  try {
    fs.mkdirSync(dir, { recursive: true });
    watcher = fs.watch(dir, (_event, filename) => {
      if (filename === 'history.jsonl' && pendingSessions.size > 0) {
        readNewEntries();
      }
    });
  } catch {
    // Directory might not exist; fall through to polling
  }

  // Poll for index changes, and fall back to polling for history changes when
  // fs.watch misses events.
  pollInterval = setInterval(() => {
    if (win.isDestroyed()) return;
    if (pendingSessions.size > 0) readNewEntries();
    syncSessionTitles();
  }, 2000);
}

export function stopCodexSessionWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  pendingSessions.clear();
  assignedCodexIds.clear();
  titleSessions.clear();
  titleIndexes.clear();
  lastSize = 0;
}
