import * as pty from 'node-pty';
import { execSync, execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import type { ProviderId } from '../shared/types';
import { getProvider } from './providers/registry';
import { registerSession } from './hook-status';
import { isWin, pathSep } from './platform';
import { nvmDefaultNodeBinDir } from './providers/nvm';

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
 * On Windows, packaged Electron apps inherit PATH from explorer.exe which
 * may be stale — we read the registry for the current PATH.
 * We resolve this once by running a login shell / reading the registry.
 */
let cachedFullPath: string | null = null;

const PATH_MARKER_BEGIN = '__VY_PATH_BEGIN__';
const PATH_MARKER_END = '__VY_PATH_END__';

export function getRegistryPath(): string {
  if (!isWin) return '';

  const parse = (output: string): string => {
    const match = output.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
    if (!match) return '';
    let value = match[1].trim();
    value = value.replace(/%([^%]+)%/g, (_m, varName) => process.env[varName] || `%${varName}%`);
    return value;
  };

  let systemPath = '';
  try {
    systemPath = parse(execSync(
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path',
      { encoding: 'utf-8', timeout: 3000, windowsHide: true },
    ));
  } catch {}

  let userPath = '';
  try {
    userPath = parse(execSync(
      'reg query "HKCU\\Environment" /v Path',
      { encoding: 'utf-8', timeout: 3000, windowsHide: true },
    ));
  } catch {}

  return [systemPath, userPath].filter(Boolean).join(pathSep);
}

/** Reset cached PATH (used after install-then-retry flows and in tests). */
export function resetPathCache(): void {
  cachedFullPath = null;
}

export function getFullPath(): string {
  if (cachedFullPath) return cachedFullPath;

  const currentPath = process.env.PATH || '';

  if (isWin) {
    const home = os.homedir();
    const extraDirs = [
      path.join(home, 'AppData', 'Roaming', 'npm'),
      path.join(home, '.local', 'bin'),
    ];

    // Read the up-to-date PATH from the Windows registry
    const registryPath = getRegistryPath();

    const pathSet = new Set([
      ...currentPath.split(pathSep),
      ...registryPath.split(pathSep),
    ]);
    for (const dir of extraDirs) {
      pathSet.add(dir);
    }
    cachedFullPath = Array.from(pathSet).join(pathSep);
    return cachedFullPath;
  }

  const shell = process.env.SHELL || '/bin/zsh';

  // -i is required: nvm exports PATH from ~/.zshrc, only sourced for interactive shells.
  try {
    const shellPath = execSync(
      `${shell} -ilc 'echo "${PATH_MARKER_BEGIN}${'${PATH}'}${PATH_MARKER_END}"'`,
      {
        encoding: 'utf-8',
        timeout: 8000,
        env: { ...process.env, HOME: os.homedir() },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const match = shellPath.match(
      new RegExp(`${PATH_MARKER_BEGIN}([\\s\\S]*?)${PATH_MARKER_END}`),
    );
    if (match && match[1]) {
      cachedFullPath = match[1].trim();
      return cachedFullPath;
    }
  } catch (err) { console.warn('Failed to resolve PATH from login shell:', err); }

  const home = os.homedir();
  const extraDirs = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/sbin',
    '/opt/homebrew/sbin',
  ];
  const nvmBin = nvmDefaultNodeBinDir();
  if (nvmBin) extraDirs.push(nvmBin);

  const pathSet = new Set(currentPath.split(pathSep));
  for (const dir of extraDirs) {
    pathSet.add(dir);
  }
  cachedFullPath = Array.from(pathSet).join(pathSep);
  return cachedFullPath;
}

/**
 * On Windows, .cmd/.bat and .ps1 files cannot be spawned directly by node-pty
 * (CreateProcess returns error 193). Wrap them via cmd.exe or powershell.exe.
 */
export function resolveWindowsShell(
  shell: string,
  args: string[]
): { shell: string; args: string[] } {
  if (!isWin) return { shell, args };
  const ext = path.extname(shell).toLowerCase();
  // .exe files can be spawned directly by CreateProcess
  if (ext === '.exe') return { shell, args };
  // .ps1 scripts need PowerShell
  if (ext === '.ps1') {
    return {
      shell: 'powershell.exe',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', shell, ...args],
    };
  }
  // Everything else (.cmd, .bat, bare names, extensionless paths):
  // wrap with cmd.exe so CreateProcess doesn't choke on non-PE binaries.
  return { shell: 'cmd.exe', args: ['/c', shell, ...args] };
}

export async function spawnPty(
  sessionId: string,
  cwd: string,
  cliSessionId: string | null,
  isResume: boolean,
  extraArgs: string,
  providerId: ProviderId,
  initialPrompt: string | undefined,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): Promise<void> {
  if (ptys.has(sessionId)) {
    // Silence the old PTY's exit event so it doesn't remove the new session
    silencedExits.add(sessionId);
    killPty(sessionId);
  }

  registerSession(sessionId);

  const provider = getProvider(providerId);

  // Copilot CLI loads hooks from <cwd>/.github/hooks/*.json, so we must
  // install the hook file before spawning the binary. Other providers use
  // global config and are already handled at app boot.
  if (providerId === 'copilot') {
    try {
      await provider.installHooks(null, cwd);
    } catch (err) {
      console.warn('Failed to install Copilot hooks for project:', cwd, err);
    }
  }

  const env = provider.buildEnv(sessionId, { ...process.env } as Record<string, string>);
  const args = provider.buildArgs({ cliSessionId, isResume, extraArgs, initialPrompt });
  const resolvedShell = provider.resolveBinaryPath();
  const { shell, args: spawnArgs } = resolveWindowsShell(resolvedShell, args);

  const ptyProcess = pty.spawn(shell, spawnArgs, {
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

// node-pty on Windows throws synchronously from write/resize/kill when the
// underlying child process has already exited (see microsoft/node-pty#887).
// A single dead PTY must not be allowed to crash the main Electron process
// — it would take down every other active session with it. Guard each
// operation, log a warning, and drop the dead handle from the map.

export function writePty(sessionId: string, data: string): void {
  const instance = ptys.get(sessionId);
  if (!instance) return;
  try {
    instance.process.write(data);
  } catch (err) {
    console.warn(`[pty-manager] writePty("${sessionId}") failed: ${(err as Error).message}`);
    ptys.delete(sessionId);
  }
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const instance = ptys.get(sessionId);
  if (!instance) return;
  try {
    instance.process.resize(cols, rows);
  } catch (err) {
    console.warn(`[pty-manager] resizePty("${sessionId}") failed: ${(err as Error).message}`);
    ptys.delete(sessionId);
  }
}

export function killPty(sessionId: string): void {
  const instance = ptys.get(sessionId);
  if (!instance) return;
  try {
    instance.process.kill();
  } catch (err) {
    console.warn(`[pty-manager] killPty("${sessionId}") failed: ${(err as Error).message}`);
  } finally {
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

  const shell = isWin
    ? (process.env.COMSPEC || 'cmd.exe')
    : (process.env.SHELL || '/bin/zsh');
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
