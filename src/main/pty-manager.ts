import * as pty from 'node-pty';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

interface PtyInstance {
  process: pty.IPty;
  sessionId: string;
}

const ptys = new Map<string, PtyInstance>();
const silencedExits = new Set<string>();

/**
 * Get a full PATH that includes common binary directories.
 * When Electron is launched from macOS (e.g. via DMG), process.env.PATH
 * is minimal and won't include dirs like /usr/local/bin or /opt/homebrew/bin.
 */
function getFullPath(): string {
  const currentPath = process.env.PATH || '';
  const home = os.homedir();
  const extraDirs = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/sbin',
    '/opt/homebrew/sbin',
  ];

  const pathSet = new Set(currentPath.split(':'));
  for (const dir of extraDirs) {
    pathSet.add(dir);
  }
  return Array.from(pathSet).join(':');
}

/**
 * Resolve the full path to the `claude` binary.
 * Falls back to bare 'claude' if resolution fails.
 */
function resolveClaudePath(): string {
  const fullPath = getFullPath();

  // Check common locations directly
  const candidates = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(os.homedir(), '.npm-global', 'bin', 'claude'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {}
  }

  // Try `which` with augmented PATH
  try {
    const resolved = execSync('which claude', {
      env: { ...process.env, PATH: fullPath },
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (resolved) return resolved;
  } catch {}

  return 'claude';
}

let cachedClaudePath: string | null = null;

function getClaudeBinary(): string {
  if (!cachedClaudePath) {
    cachedClaudePath = resolveClaudePath();
  }
  return cachedClaudePath;
}

export function spawnPty(
  sessionId: string,
  cwd: string,
  claudeSessionId: string | null,
  isResume: boolean,
  extraArgs: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): void {
  if (ptys.has(sessionId)) {
    // Silence the old PTY's exit event so it doesn't remove the new session
    silencedExits.add(sessionId);
    killPty(sessionId);
  }

  const env = { ...process.env };
  delete env.CLAUDE_CODE; // avoid subprocess detection conflicts
  env.CLAUDE_IDE_SESSION_ID = sessionId;
  env.CLAUDE_CODE_STATUSLINE = '/tmp/ccide/statusline.sh';
  env.PATH = getFullPath();

  const args: string[] = [];
  if (claudeSessionId) {
    if (isResume) {
      args.push('-r', claudeSessionId);
    } else {
      args.push('--session-id', claudeSessionId);
    }
  }

  if (extraArgs) {
    args.push(...extraArgs.split(/\s+/).filter(Boolean));
  }

  const shell = getClaudeBinary();
  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
    // Only remove from map if this PTY is still the active one for this session
    const current = ptys.get(sessionId);
    if (current?.process === ptyProcess) {
      ptys.delete(sessionId);
    }
    onExit(exitCode, signal);
  });

  ptys.set(sessionId, { process: ptyProcess, sessionId });
}

export function writePty(sessionId: string, data: string): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.write(data);
  }
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.resize(cols, rows);
  }
}

export function killPty(sessionId: string): void {
  const instance = ptys.get(sessionId);
  if (instance) {
    instance.process.kill();
    ptys.delete(sessionId);
  }
}

export function spawnShellPty(
  sessionId: string,
  cwd: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): void {
  if (ptys.has(sessionId)) {
    killPty(sessionId);
  }

  const shell = process.env.SHELL || '/bin/zsh';
  const shellEnv = { ...process.env, PATH: getFullPath() };
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 15,
    cwd,
    env: shellEnv,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
    ptys.delete(sessionId);
    onExit(exitCode, signal);
  });

  ptys.set(sessionId, { process: ptyProcess, sessionId });
}

export function isSilencedExit(sessionId: string): boolean {
  return silencedExits.delete(sessionId);
}

export function killAllPtys(): void {
  for (const [id] of ptys) {
    killPty(id);
  }
}
