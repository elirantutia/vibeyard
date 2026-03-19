import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';

const STATUS_DIR = '/tmp/ccide';
const STATUSLINE_SCRIPT = path.join(STATUS_DIR, 'statusline.sh');

let watcher: fs.FSWatcher | null = null;

export function installStatusLineScript(): void {
  fs.mkdirSync(STATUS_DIR, { recursive: true });

  const script = `#!/bin/sh
input=$(cat)
echo "$input" | /usr/bin/python3 -c "
import sys,json,os
d=json.load(sys.stdin)
cost=d.get('cost',{})
ctx=d.get('context_window',{})
sid=os.environ.get('CLAUDE_IDE_SESSION_ID','')
if sid:
    with open(f'/tmp/ccide/{sid}.cost','w') as f:
        json.dump({'cost':cost,'context_window':ctx},f)
    claude_sid=d.get('session_id','')
    if claude_sid:
        with open(f'/tmp/ccide/{sid}.sessionid','w') as f:
            f.write(claude_sid)
" 2>/dev/null
`;

  fs.writeFileSync(STATUSLINE_SCRIPT, script, { mode: 0o755 });
}

function handleFileChange(win: BrowserWindow, filename: string): void {
  if (filename.endsWith('.status')) {
    const sessionId = filename.replace('.status', '');
    const filePath = path.join(STATUS_DIR, filename);

    try {
      const content = fs.readFileSync(filePath, 'utf-8').trim();
      if (content === 'working' || content === 'waiting' || content === 'completed' || content === 'permission') {
        if (!win.isDestroyed()) {
          win.webContents.send('session:hookStatus', sessionId, content);
        }
      }
    } catch {
      // File may have been deleted between watch event and read
    }
  } else if (filename.endsWith('.sessionid')) {
    const sessionId = filename.replace('.sessionid', '');
    const filePath = path.join(STATUS_DIR, filename);

    try {
      const claudeSessionId = fs.readFileSync(filePath, 'utf-8').trim();
      if (claudeSessionId && !win.isDestroyed()) {
        win.webContents.send('session:claudeSessionId', sessionId, claudeSessionId);
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
  }
}

function restartWatcher(win: BrowserWindow): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }

  fs.mkdirSync(STATUS_DIR, { recursive: true });

  watcher = fs.watch(STATUS_DIR, (_eventType, filename) => {
    if (!filename) return;
    handleFileChange(win, filename);
  });
}

export function resyncAllSessions(win: BrowserWindow): void {
  if (win.isDestroyed()) return;

  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const filename of files) {
      if (filename.endsWith('.status') || filename.endsWith('.sessionid') || filename.endsWith('.cost')) {
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
  for (const ext of ['.status', '.sessionid', '.cost']) {
    try {
      fs.unlinkSync(path.join(STATUS_DIR, `${sessionId}${ext}`));
    } catch {
      // Already gone
    }
  }
}

export function cleanupAll(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  try {
    const files = fs.readdirSync(STATUS_DIR);
    for (const file of files) {
      if (file.endsWith('.status') || file.endsWith('.sessionid') || file.endsWith('.cost')) {
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
