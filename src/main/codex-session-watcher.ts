import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { STATUS_DIR } from './hook-status';

const HISTORY_PATH = path.join(os.homedir(), '.codex', 'history.jsonl');

/**
 * Codex CLI has no hook system to report session IDs back to the host app.
 * Instead, we tail ~/.codex/history.jsonl for new entries and extract the
 * session_id, then write a .sessionid file so hook-status picks it up.
 */

// Maps UI session ID → registration timestamp (for FIFO ordering)
const pendingSessions = new Map<string, number>();
const assignedCodexIds = new Set<string>();

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

  // Polling fallback — fs.watch can miss events on some systems
  pollInterval = setInterval(() => {
    if (pendingSessions.size > 0 && !win.isDestroyed()) {
      readNewEntries();
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
}
