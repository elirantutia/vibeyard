import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';

export const STATUS_DIR = path.join(os.tmpdir(), 'vibeyard');
const STATUSLINE_SCRIPT = path.join(STATUS_DIR, 'statusline.sh');

const KNOWN_EXTENSIONS = ['.status', '.sessionid', '.cost', '.toolfailure', '.events'];

let watcher: fs.FSWatcher | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
const lastMtimes = new Map<string, number>();
const eventFileOffsets = new Map<string, number>();

function isKnownExtension(filename: string): boolean {
  return KNOWN_EXTENSIONS.some(ext => filename.endsWith(ext));
}

export function getStatusLineScriptPath(): string {
  return STATUSLINE_SCRIPT;
}

export function installStatusLineScript(): void {
  fs.mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });

  // Script that extracts cost, context_window, and session_id from hook JSON stdin.
  // Used by hook commands to write .cost and .sessionid files to STATUS_DIR.
  const script = `#!/bin/sh
/usr/bin/python3 -c "
import sys,json,os
try:
    d=json.load(sys.stdin)
except:
    sys.exit(0)
sid=os.environ.get('CLAUDE_IDE_SESSION_ID','')
if not sid:
    sys.exit(0)
cost=d.get('cost',{})
ctx=d.get('context_window',{})
model=d.get('model',{}).get('display_name','')
if cost or ctx or model:
    payload={'cost':cost,'context_window':ctx}
    if model:
        payload['model']=model
    with open(f'${STATUS_DIR}/{sid}.cost','w') as f:
        json.dump(payload,f)
claude_sid=d.get('session_id','')
if claude_sid:
    with open(f'${STATUS_DIR}/{sid}.sessionid','w') as f:
        f.write(claude_sid)
" 2>>${STATUS_DIR}/statusline.log
`;

  fs.writeFileSync(STATUSLINE_SCRIPT, script, { mode: 0o755 });
}

function handleFileChange(win: BrowserWindow, filename: string): void {
  if (filename.endsWith('.status')) {
    const sessionId = filename.replace('.status', '');
    const filePath = path.join(STATUS_DIR, filename);

    try {
      const raw = fs.readFileSync(filePath, 'utf-8').trim();
      // Format: "HookEvent:status" (e.g. "PostToolUse:working") or legacy plain status
      const colonIdx = raw.indexOf(':');
      const hookName = colonIdx !== -1 ? raw.slice(0, colonIdx) : '';
      const content = colonIdx !== -1 ? raw.slice(colonIdx + 1) : raw;
      if (content === 'working' || content === 'waiting' || content === 'completed' || content === 'input') {
        if (!win.isDestroyed()) {
          win.webContents.send('session:hookStatus', sessionId, content, hookName);
        }
      }
    } catch {
      // File may have been deleted between watch event and read
    }
  } else if (filename.endsWith('.sessionid')) {
    const sessionId = filename.replace('.sessionid', '');
    const filePath = path.join(STATUS_DIR, filename);

    try {
      const cliSessionId = fs.readFileSync(filePath, 'utf-8').trim();
      if (cliSessionId && !win.isDestroyed()) {
        win.webContents.send('session:cliSessionId', sessionId, cliSessionId);
        // Backward compatibility
        win.webContents.send('session:claudeSessionId', sessionId, cliSessionId);
      }
    } catch {
      // File may have been deleted between watch event and read
    }
  } else if (filename.endsWith('.cost')) {
    const sessionId = filename.replace('.cost', '');
    const filePath = path.join(STATUS_DIR, filename);

    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const costData = JSON.parse(content);
      if (!win.isDestroyed()) {
        win.webContents.send('session:costData', sessionId, costData);
      }
    } catch {
      // File may have been deleted or contain invalid JSON
    }
  } else if (filename.endsWith('.toolfailure')) {
    // Filename format: {sessionId}-{randomSuffix}.toolfailure
    const base = filename.replace('.toolfailure', '');
    const lastDash = base.lastIndexOf('-');
    const sessionId = lastDash !== -1 ? base.slice(0, lastDash) : base;
    const filePath = path.join(STATUS_DIR, filename);

    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const data = JSON.parse(content);
      if (!win.isDestroyed()) {
        win.webContents.send('session:toolFailure', sessionId, data);
      }
    } catch {
      // File may have been deleted or contain invalid JSON
    }
    // Always attempt cleanup — each failure is a one-shot event
    try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  } else if (filename.endsWith('.events')) {
    const sessionId = filename.replace('.events', '');
    const filePath = path.join(STATUS_DIR, filename);
    const offset = eventFileOffsets.get(sessionId) ?? 0;

    let fd: number | null = null;
    try {
      fd = fs.openSync(filePath, 'r');
      const stat = fs.fstatSync(fd);
      if (stat.size > offset) {
        const buf = Buffer.alloc(stat.size - offset);
        fs.readSync(fd, buf, 0, buf.length, offset);
        eventFileOffsets.set(sessionId, stat.size);

        const lines = buf.toString('utf-8').trim().split('\n').filter(Boolean);
        const events = [];
        for (const line of lines) {
          try { events.push(JSON.parse(line)); } catch { /* skip malformed */ }
        }
        if (events.length > 0 && !win.isDestroyed()) {
          win.webContents.send('session:inspectorEvents', sessionId, events);
        }
      }
    } catch {
      // File may not exist yet
    } finally {
      if (fd !== null) {
        try { fs.closeSync(fd); } catch { /* already closed */ }
      }
    }
  }
}

function pollForChanges(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const filename of files) {
      if (!isKnownExtension(filename)) continue;
      const filePath = path.join(STATUS_DIR, filename);
      try {
        const stat = fs.statSync(filePath);
        const mtime = stat.mtimeMs;
        const prev = lastMtimes.get(filename);
        if (prev === undefined || mtime > prev) {
          lastMtimes.set(filename, mtime);
          if (prev !== undefined) {
            handleFileChange(win, filename);
          }
        }
      } catch {
        // File may have been deleted
      }
    }
  } catch {
    // Directory may not exist yet
  }
}

function startPolling(win: BrowserWindow): void {
  stopPolling();
  pollInterval = setInterval(() => pollForChanges(win), 2000);
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  lastMtimes.clear();
}

function restartWatcher(win: BrowserWindow): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }

  fs.mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });

  watcher = fs.watch(STATUS_DIR, (_eventType, filename) => {
    if (!filename) {
      resyncAllSessions(win);
      return;
    }
    handleFileChange(win, filename);
  });

  startPolling(win);
}

export function resyncAllSessions(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const filename of files) {
      if (isKnownExtension(filename)) {
        handleFileChange(win, filename);
      }
    }
  } catch {
    // Directory may not exist yet
  }
}

export function restartAndResync(win: BrowserWindow): void {
  restartWatcher(win);
  resyncAllSessions(win);
}

export function startWatching(win: BrowserWindow): void {
  restartWatcher(win);
}

export function cleanupSessionStatus(sessionId: string): void {
  for (const ext of KNOWN_EXTENSIONS) {
    try {
      fs.unlinkSync(path.join(STATUS_DIR, `${sessionId}${ext}`));
    } catch {
      // Already gone
    }
  }
  eventFileOffsets.delete(sessionId);
}

export function cleanupAll(): void {
  stopPolling();
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const file of files) {
      if (isKnownExtension(file)) {
        fs.unlinkSync(path.join(STATUS_DIR, file));
      }
    }
    // Remove the statusline script
    try { fs.unlinkSync(STATUSLINE_SCRIPT); } catch { /* already gone */ }
    fs.rmdirSync(STATUS_DIR);
  } catch {
    // Directory may not exist
  }
}
