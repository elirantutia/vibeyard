import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { writeCliSessionId } from './hook-status';

const HISTORY_PATH = path.join(os.homedir(), '.codex', 'history.jsonl');

/**
 * Codex CLI has no hook system to report session IDs back to the host app.
 * Instead, we tail ~/.codex/history.jsonl for new entries and extract the
 * session_id, then write a .sessionid file so hook-status picks it up.
 */

// Maps UI session ID → registration timestamp (for FIFO ordering)
const pendingSessions = new Map<string, number>();
const assignedCodexIds = new Set<string>();
// Bounded: the set exists to dedupe ids already handed out; evict oldest
// (Sets preserve insertion order) so it can't grow for the app's lifetime.
const MAX_ASSIGNED_IDS = 1000;

function rememberAssignedId(id: string): void {
  if (assignedCodexIds.size >= MAX_ASSIGNED_IDS) {
    const oldest = assignedCodexIds.values().next().value;
    if (oldest !== undefined) assignedCodexIds.delete(oldest);
  }
  assignedCodexIds.add(id);
}

let watcher: fs.FSWatcher | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
let lastSize = 0;
let pendingLine = '';
const MAX_HISTORY_READ_BYTES = 256 * 1024;
const MAX_HISTORY_LINE_CHARS = 1024 * 1024;

function readNewEntries(): void {
  if (pendingSessions.size === 0) return;

  let stat: fs.Stats;
  try {
    stat = fs.statSync(HISTORY_PATH);
  } catch {
    return;
  }

  if (stat.size < lastSize) {
    lastSize = 0;
    pendingLine = '';
  }
  if (stat.size === lastSize) return;

  let fd: number | null = null;
  try {
    fd = fs.openSync(HISTORY_PATH, 'r');
    const buf = Buffer.alloc(Math.min(stat.size - lastSize, MAX_HISTORY_READ_BYTES));
    const bytesRead = fs.readSync(fd, buf, 0, buf.length, lastSize);
    lastSize += bytesRead;
    if (bytesRead === 0) return;
    const data = pendingLine + buf.toString('utf-8', 0, bytesRead);
    const lastNewline = data.lastIndexOf('\n');
    if (lastNewline < 0) {
      pendingLine = data.length <= MAX_HISTORY_LINE_CHARS ? data : '';
      return;
    }
    const lines = data.slice(0, lastNewline).split('\n').filter(Boolean);
    pendingLine = data.slice(lastNewline + 1);
    if (pendingLine.length > MAX_HISTORY_LINE_CHARS) pendingLine = '';

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
          rememberAssignedId(codexSessionId);
          pendingSessions.delete(oldestId);

          writeCliSessionId(oldestId, codexSessionId);
          if (pendingSessions.size === 0) break;
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
    pendingLine = '';
  }

  pendingSessions.set(sessionId, Date.now());
}

export function unregisterCodexSession(sessionId: string): void {
  pendingSessions.delete(sessionId);
}

export function startCodexSessionWatcher(win: BrowserWindow): void {
  if (watcher) return;

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

  // Polling fallback — fs.watch can miss events on some systems. Look the
  // window up per tick so a destroyed-and-recreated window doesn't kill the
  // polling fallback for good.
  pollInterval = setInterval(() => {
    if (pendingSessions.size > 0) {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) readNewEntries();
    }
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
  lastSize = 0;
  pendingLine = '';
}
