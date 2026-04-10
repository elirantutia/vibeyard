import * as pty from 'node-pty';
import { execSync, execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import type { ProviderId, Preferences } from '../shared/types';
import { getProvider } from './providers/registry';
import { registerSession } from './hook-status';
import { isWin, pathSep, isWslMode } from './platform';
import { loadState } from './store';

interface PtyInstance {
  process: pty.IPty;
  sessionId: string;
}

const ptys = new Map<string, PtyInstance>();
const silencedExits = new Set<string>();

/**
 * Get the full PATH by sourcing the user's login shell.
 * When Electron is launched from macOS Finder/Dock, process.env.PATH
 * is minimal (/usr/bin:/bin:/usr/sbin:/sbin) and misses nvm, homebrew, etc.
 * We resolve this once by running a login shell to get the real PATH.
 */
let cachedFullPath: string | null = null;

export function getFullPath(): string {
  if (cachedFullPath) return cachedFullPath;

  const currentPath = process.env.PATH || '';

  if (isWin) {
    // On Windows, PATH is generally correct — just ensure npm/appdata dirs are present
    const home = os.homedir();
    const extraDirs = [
      path.join(home, 'AppData', 'Roaming', 'npm'),
      path.join(home, '.local', 'bin'),
    ];
    const pathSet = new Set(currentPath.split(pathSep));
    for (const dir of extraDirs) {
      pathSet.add(dir);
    }
    cachedFullPath = Array.from(pathSet).join(pathSep);
    return cachedFullPath;
  }

  const shell = process.env.SHELL || '/bin/zsh';

  // Try to get the real PATH from a login shell
  try {
    const shellPath = execSync(`${shell} -ilc 'echo __PATH__=$PATH'`, {
      encoding: 'utf-8',
      timeout: 5000,
      env: { ...process.env, HOME: os.homedir() },
    });
    const match = shellPath.match(/__PATH__=(.+)/);
    if (match && match[1]) {
      cachedFullPath = match[1].trim();
      return cachedFullPath;
    }
  } catch (err) { console.warn('Failed to resolve PATH from login shell:', err); }

  // Fallback: merge current PATH with common directories
  const home = os.homedir();
  const extraDirs = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/sbin',
    '/opt/homebrew/sbin',
  ];

  const pathSet = new Set(currentPath.split(pathSep));
  for (const dir of extraDirs) {
    pathSet.add(dir);
  }
  cachedFullPath = Array.from(pathSet).join(pathSep);
  return cachedFullPath;
}

export function spawnPty(
  sessionId: string,
  cwd: string,
  cliSessionId: string | null,
  isResume: boolean,
  extraArgs: string,
  providerId: ProviderId,
  initialPrompt: string | undefined,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): void {
  if (ptys.has(sessionId)) {
    silencedExits.add(sessionId);
    killPty(sessionId);
  }

  registerSession(sessionId);

  const provider = getProvider(providerId);
  const env = provider.buildEnv(sessionId, { ...process.env } as Record<string, string>);
  const cliArgs = provider.buildArgs({ cliSessionId, isResume, extraArgs, initialPrompt });
  const cliBinary = provider.resolveBinaryPath();

  const state = loadState();
  const wslActive = isWslMode(state.preferences);

  let shell: string;
  let args: string[];
  let ptyCwd: string;

  if (wslActive) {
    const { getEffectiveDistro, winPathToWsl, uncWslPathToLinuxPath } = require('./wsl') as typeof import('./wsl');
    const distro = getEffectiveDistro(state.preferences.wslDistro) || 'Ubuntu';

    shell = 'wsl.exe';
    // Linux cwd for the CLI: `wsl` was previously spawned without --cd, so Claude
    // always saw `/mnt/c/.../Temp`. `--cd` sets the WSL working directory.
    const fromUnc = uncWslPathToLinuxPath(cwd);
    ptyCwd = fromUnc
      ? fromUnc
      : cwd.includes('\\') || /^[A-Za-z]:/.test(cwd)
        ? winPathToWsl(cwd, distro)
        : cwd;

    const envPairs = [`CLAUDE_IDE_SESSION_ID=${env.CLAUDE_IDE_SESSION_ID || sessionId}`];
    args = ['-d', distro, '--cd', ptyCwd, '--', 'env', ...envPairs, cliBinary, ...cliArgs];
  } else {
    shell = cliBinary;
    args = cliArgs;
    ptyCwd = cwd;
  }

  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: wslActive ? os.tmpdir() : ptyCwd,
    env: wslActive ? process.env as Record<string, string> : env,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
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

  const state = loadState();
  const wslActive = isWslMode(state.preferences);

  let shell: string;
  let shellArgs: string[];
  let ptyCwd: string;

  if (wslActive) {
    const { getEffectiveDistro, winPathToWsl, uncWslPathToLinuxPath } = require('./wsl') as typeof import('./wsl');
    const distro = getEffectiveDistro(state.preferences.wslDistro) || 'Ubuntu';
    shell = 'wsl.exe';
    const fromUnc = uncWslPathToLinuxPath(cwd);
    const wslShellCwd = fromUnc
      ? fromUnc
      : cwd.includes('\\') || /^[A-Za-z]:/.test(cwd)
        ? winPathToWsl(cwd, distro)
        : cwd;
    shellArgs = ['-d', distro, '--cd', wslShellCwd];
    ptyCwd = os.tmpdir();
  } else if (isWin) {
    shell = process.env.COMSPEC || 'cmd.exe';
    shellArgs = [];
    ptyCwd = cwd;
  } else {
    shell = process.env.SHELL || '/bin/zsh';
    shellArgs = [];
    ptyCwd = cwd;
  }

  const shellEnv = { ...process.env, PATH: getFullPath() };
  const ptyProcess = pty.spawn(shell, shellArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 15,
    cwd: ptyCwd,
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

/**
 * Get the current working directory of a PTY's deepest child process.
 * Uses pgrep/lsof on Unix. Not supported on Windows (returns null).
 */
export function getPtyCwd(sessionId: string): Promise<string | null> {
  const instance = ptys.get(sessionId);
  if (!instance) return Promise.resolve(null);

  const pid = instance.process.pid;

  if (isWin) {
    return getPtyCwdWindows(pid);
  }

  return new Promise((resolve) => {
    // Find deepest child process recursively
    findDeepestChild(pid, (deepestPid) => {
      // Read cwd of the deepest process via lsof
      execFile(
        'lsof',
        ['-a', '-d', 'cwd', '-Fn', '-p', String(deepestPid)],
        { timeout: 3000 },
        (err, stdout) => {
          if (err) {
            resolve(null);
            return;
          }
          // Parse lsof output: lines starting with 'n' contain the path
          for (const line of stdout.split('\n')) {
            if (line.startsWith('n') && line.length > 1) {
              resolve(line.slice(1));
              return;
            }
          }
          resolve(null);
        }
      );
    });
  });
}

function getPtyCwdWindows(_pid: number): Promise<string | null> {
  // Windows does not expose process cwd reliably via standard APIs.
  // This is a best-effort no-op — cwd tracking is not supported on Windows.
  return Promise.resolve(null);
}

function findDeepestChild(pid: number, callback: (deepestPid: number) => void): void {
  execFile(
    'pgrep',
    ['-P', String(pid)],
    { timeout: 3000 },
    (err, stdout) => {
      if (err || !stdout.trim()) {
        // No children — this is the deepest
        callback(pid);
        return;
      }
      const children = stdout.trim().split('\n').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
      if (children.length === 0) {
        callback(pid);
        return;
      }
      // Recurse into the last child (most recent)
      findDeepestChild(children[children.length - 1], callback);
    }
  );
}
