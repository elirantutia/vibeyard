import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { BrowserWindow } from 'electron';
import { isWin, pythonBin } from './platform';

export const STATUS_DIR = path.join(os.tmpdir(), 'vibeyard');
export const SCRIPT_DIR = path.join(os.homedir(), '.vibeyard', 'run');
const STATUSLINE_SCRIPT = path.join(SCRIPT_DIR, isWin ? 'statusline.cmd' : 'statusline.sh');

// Status files any provider may write into STATUS_DIR, keyed by Vibeyard's
// session id. This array drives cleanup, polling and resync generically.
//
// `.name` is a provider-facing channel, not Claude-private: write
// `{"name": "…", "session_id": "…"}` and the tab adopts that title. Claude
// fills it from its statusLine payload (see buildStatusLinePython); another
// provider can populate it from any source, the way codex-session-watcher.ts
// already writes `.sessionid` without hooks.
const KNOWN_EXTENSIONS = ['.status', '.sessionid', '.cost', '.name', '.toolfailure', '.events', '.subagents'];

let watcher: fs.FSWatcher | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;
const lastMtimes = new Map<string, number>();
const eventFileOffsets = new Map<string, number>();
const knownSessionIds = new Set<string>();

export function registerSession(sessionId: string): void {
  knownSessionIds.add(sessionId);
}

export function unregisterSession(sessionId: string): void {
  knownSessionIds.delete(sessionId);
}

function isKnownExtension(filename: string): boolean {
  return KNOWN_EXTENSIONS.some(ext => filename.endsWith(ext));
}

export function getStatusLineScriptPath(): string {
  return STATUSLINE_SCRIPT;
}

/**
 * Body of the statusLine helper, shared by the POSIX and Windows branches.
 *
 * Claude invokes the statusLine command on every render, piping it the session
 * JSON on stdin. We extract `cost`, `context_window`, `session_id` and
 * `session_name` and drop them into STATUS_DIR for the watcher to pick up.
 * The `.name` payload carries the CLI session id alongside the title so a
 * stale title can be told apart from the current conversation's.
 *
 * Installed as a real `.py` file on every platform and invoked by path, never
 * inlined into the shell command — see the module docstring in
 * `hook-commands.ts` for why inlining Python is fragile here.
 *
 * `statusDir` is embedded via `JSON.stringify`, whose escapes (`\\`, `\"`,
 * `\uXXXX`) are all valid Python ones. A raw literal would break on an
 * apostrophe in the path — e.g. a Windows user named O'Brien — and a
 * SyntaxError here silently kills cost, context, sessionid and name at once.
 */
export function buildStatusLinePython(statusDir: string): string {
  return `import sys,json,os
try:
    d=json.load(sys.stdin)
except:
    sys.exit(0)
sid=os.environ.get('CLAUDE_IDE_SESSION_ID','')
if not sid:
    sys.exit(0)
status_dir=${JSON.stringify(statusDir)}
cost=d.get('cost',{})
ctx=d.get('context_window',{})
model=d.get('model',{}).get('display_name','')
if cost or ctx or model:
    payload={'cost':cost,'context_window':ctx}
    if model:
        payload['model']=model
    with open(os.path.join(status_dir,sid+'.cost'),'w') as f:
        json.dump(payload,f)
claude_sid=d.get('session_id','')
if claude_sid:
    with open(os.path.join(status_dir,sid+'.sessionid'),'w') as f:
        f.write(claude_sid)
name_path=os.path.join(status_dir,sid+'.name')
name=str(d.get('session_name') or '').strip()
blob=json.dumps({'name':name,'session_id':claude_sid}) if name else ''
prev=''
try:
    with open(name_path) as f:
        prev=f.read()
except:
    pass
if prev!=blob:
    try:
        if blob:
            with open(name_path,'w') as f:
                f.write(blob)
        else:
            os.remove(name_path)
    except:
        pass
`;
}

export function installStatusLineScript(): void {
  fs.mkdirSync(STATUS_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(SCRIPT_DIR, { recursive: true, mode: 0o700 });

  const pyPath = path.join(SCRIPT_DIR, 'statusline.py');
  fs.writeFileSync(pyPath, buildStatusLinePython(STATUS_DIR), { mode: 0o755 });

  // Use forward slashes — backslashes inside double-quoted .cmd strings can
  // interfere with cmd.exe's >> redirection parsing on some Windows versions.
  const logPath = `${STATUS_DIR.replace(/\\/g, '/')}/statusline.log`;
  const script = isWin
    ? `@echo off\r\n${pythonBin} "${pyPath}" 2>>"${logPath}"\r\n`
    : `#!/bin/sh\n${pythonBin} "${pyPath}" 2>>"${logPath}"\n`;

  fs.writeFileSync(STATUSLINE_SCRIPT, script, { mode: 0o755 });
}

function extractSessionId(filename: string): string {
  if (filename.endsWith('.toolfailure')) {
    const base = filename.replace('.toolfailure', '');
    const lastDash = base.lastIndexOf('-');
    return lastDash !== -1 ? base.slice(0, lastDash) : base;
  }
  for (const ext of KNOWN_EXTENSIONS) {
    if (filename.endsWith(ext)) return filename.slice(0, -ext.length);
  }
  return '';
}

function handleFileChange(win: BrowserWindow, filename: string): void {
  const extractedId = extractSessionId(filename);
  if (extractedId && !knownSessionIds.has(extractedId)) return;

  // In-flight subagent counter — hook-internal only, never forwarded to the
  // renderer. Included in KNOWN_EXTENSIONS solely for cleanup.
  if (filename.endsWith('.subagents')) return;

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
  } else if (filename.endsWith('.name')) {
    const sessionId = extractedId;
    const filePath = path.join(STATUS_DIR, filename);

    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      const { name, session_id: cliSessionId } = JSON.parse(content);
      if (typeof name === 'string' && name && !win.isDestroyed()) {
        // cliSessionId lets the renderer drop a title left over from a
        // conversation that has since been cleared — resyncAllSessions
        // re-reads every file, so a stale .name would otherwise re-title
        // the freshly reset tab.
        win.webContents.send(
          'session:sessionName',
          sessionId,
          name,
          typeof cliSessionId === 'string' ? cliSessionId : '',
        );
      }
    } catch {
      // File may have been deleted or contain invalid JSON (partial write)
    }
  } else if (filename.endsWith('.toolfailure')) {
    const sessionId = extractedId;
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
        // `!==`, not `>`: `.name` is deleted and rewritten on /clear, and a
        // recreated file can carry a coarser, non-increasing timestamp.
        if (prev !== mtime) {
          lastMtimes.set(filename, mtime);
          if (prev !== undefined) {
            handleFileChange(win, filename);
          }
        }
      } catch {
        // File may have been deleted between readdir and stat
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
  unregisterSession(sessionId);
}

export function cleanupAll(): void {
  stopPolling();
  knownSessionIds.clear();
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  cleanupDir(STATUS_DIR, isKnownExtension);
  // SCRIPT_DIR is intentionally kept — scripts are idempotent and reinstalled
  // on launch. Deleting them races with CLI processes that outlive the app.
}

function cleanupDir(dir: string, shouldUnlink: (filename: string) => boolean): void {
  try {
    for (const file of fs.readdirSync(dir)) {
      if (shouldUnlink(file)) {
        try { fs.unlinkSync(path.join(dir, file)); } catch { /* already gone */ }
      }
    }
    try { fs.rmSync(dir, { recursive: true }); } catch { /* may not be empty */ }
  } catch {
    // Directory may not exist
  }
}
