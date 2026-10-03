import * as pty from 'node-pty';
import { execSync, execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import type { ProviderId } from '../shared/types';
import { parseEnvVars, partitionUserEnv } from '../shared/env-vars';
import { findConflictingEnvKeys, findConflictingLaunchFlags, tokenizeArgs } from '../shared/launch-args';
import { getProvider } from './providers/registry';
import { registerSession } from './hook-status';
import { installHooksOnly, installStatusLine } from './claude-cli';
import { getKeychainIsolationStatus } from './claude-keychain';
import { isWin, pathSep, utf8LocaleEnv } from './platform';
import { nvmDefaultNodeBinDir } from './providers/nvm';

interface PtyInstance {
  process: pty.IPty;
  sessionId: string;
}

const ptys = new Map<string, PtyInstance>();
// Replacement suppresses only the old process's exit. A session-id marker can
// be consumed by a fast-exiting replacement before the old kill completes.
const replacedPtys = new WeakSet<pty.IPty>();

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
  } catch (err) {
    // `reg query` exits non-zero when the value is absent; that hive simply
    // contributes nothing to PATH.
    console.debug('Could not read system PATH from registry:', err);
  }

  let userPath = '';
  try {
    userPath = parse(execSync(
      'reg query "HKCU\\Environment" /v Path',
      { encoding: 'utf-8', timeout: 3000, windowsHide: true },
    ));
  } catch (err) {
    // Same as above: a missing HKCU Environment\Path is normal, not an error.
    console.debug('Could not read user PATH from registry:', err);
  }

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
 * Fill in a UTF-8 locale when the environment names no charset, so spawned CLIs
 * and shells don't land in the C locale. A Finder/Dock-launched macOS app
 * inherits no LANG, which mangles multi-byte output and drops macOS text APIs
 * back to the legacy system encoding (#157, #160).
 *
 * Bare `C`/`POSIX` does not count as a deliberate choice — it is the very locale
 * that produces the mojibake, and a .desktop entry or systemd unit exporting
 * `LANG=C` would otherwise pin it. Resolution follows POSIX precedence, so an
 * `LC_ALL=C` really does mean the session is in the C locale.
 */
export function withUtf8Locale<T extends Record<string, string | undefined>>(env: T): T {
  const locale = env.LC_ALL || env.LC_CTYPE || env.LANG;
  if (isWin || (locale && !/^(C|POSIX)$/i.test(locale))) return env;
  return { ...env, ...utf8LocaleEnv };
}

/**
 * Make an argument safe to place on a cmd.exe command line.
 *
 * node-pty (`windowsPtyAgent.argsToCommandLine`) quotes an argument only when it
 * contains a space or a tab. A whitespace-free token carrying `&`, `|`, `<`, `>`
 * or `^` is therefore emitted raw and cmd.exe interprets it — `foo&calc.exe`
 * runs calc.exe. Wrapping the whole argument in double quotes makes cmd treat it
 * as literal text, and node-pty leaves an already-quoted argument untouched.
 *
 * A double quote, by contrast, CANNOT be conveyed through cmd.exe at all: cmd
 * toggles its quoted state on every `"` and honours no escape for it. `\` is not
 * an escape character to cmd, so `\"` does not yield a literal quote — it CLOSES
 * the quoted region and leaves everything after it live. Verified against a real
 * cmd.exe: the raw form `x"y&echo pwned>mk` is inert because the stray quote
 * opens a quoted region over the payload, while the `\"`-escaped form executes
 * it. Escaping is therefore worse than doing nothing.
 *
 * So an argument containing `"` is rejected rather than mangled. The caller
 * surfaces this as a spawn failure, which is the correct outcome; silently
 * producing an injectable command line is not.
 *
 * Residual, accepted: `%VAR%` still expands inside double quotes. That leaks an
 * environment value into the argument; it is not code execution, so a percent
 * sign stays legal rather than rejecting legitimate arguments that contain one.
 */
const CMDEXE_METACHARS = /[&|<>^]/;

function quoteArgForCmdExe(arg: string): string {
  if (arg.includes('"')) {
    const shown = arg.length > 80 ? `${arg.slice(0, 77)}...` : arg;
    throw new Error(
      'Cannot pass an argument containing a double quote through cmd.exe: cmd ' +
        'has no escape for a literal quote, so it cannot be quoted safely. ' +
        `Offending argument: ${JSON.stringify(shown)}`
    );
  }
  return CMDEXE_METACHARS.test(arg) ? `"${arg}"` : arg;
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
  // Every token must be quoted for cmd.exe — see quoteArgForCmdExe.
  return {
    shell: 'cmd.exe',
    args: ['/c', quoteArgForCmdExe(shell), ...args.map(quoteArgForCmdExe)],
  };
}

/**
 * The effective session storage mode for a launch. T2 always resolves
 * 'default' (the profile's own sessions tree); 'custom-dir' and
 * 'nonpersistent' are rejected pre-spawn until per-launch storage is
 * tracked end-to-end.
 */
export type SessionStorageMode = 'default' | 'custom-dir' | 'nonpersistent';

/**
 * One effective launch: the executable, argv, environment,
 * provider/profile identity and storage mode a session is spawned with.
 * Resolved once in spawnPty before any side effect; the child environment
 * and every lifecycle reader must agree on this single spec.
 */
export interface LaunchSpec {
  executable: string;
  argv: string[];
  env: Record<string, string>;
  providerId: ProviderId;
  /** Pinned profile config dir; undefined = the provider's default agent dir. */
  configDir: string | undefined;
  /** Effective session storage mode for this launch. */
  storageMode: SessionStorageMode;
}

/** Thrown when a launch request uses options Vibeyard cannot track. */
export class LaunchSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchSpecError';
  }
}

/**
 * Resolve the single effective launch spec for a session: executable,
 * argv, environment, provider/profile identity and storage mode.
 *
 * Profile isolation: the providers' buildEnv strips inherited native
 * profile/storage selectors, and partitionUserEnv drops user env that
 * would undo the pinned profile. Unsupported options (storage overrides,
 * profile/session-identity flags in the extra args) are rejected here —
 * before any side effect — with an actionable message.
 */
export function resolveLaunchSpec(params: {
  sessionId: string;
  cliSessionId: string | null;
  isResume: boolean;
  extraArgs: string;
  providerId: ProviderId;
  initialPrompt?: string;
  systemPrompt?: string;
  envVars: string;
  configDir?: string;
}): LaunchSpec {
  const { sessionId, cliSessionId, isResume, extraArgs, providerId, initialPrompt, systemPrompt, envVars, configDir } = params;
  const provider = getProvider(providerId);
  const issues: string[] = [];

  const userEnv = parseEnvVars(envVars);
  for (const key of findConflictingEnvKeys(userEnv)) {
    issues.push(
      `Environment variable ${key} is not supported: Vibeyard tracks sessions in the profile's default storage, ` +
        'and a custom session dir would hide them from history, search and resume. Remove it from the session environment and start again.',
    );
  }

  const env = provider.buildEnv(sessionId, withUtf8Locale({ ...process.env }) as Record<string, string>, { configDir });
  // User-provided env vars are merged last so they can override provider-set
  // vars like PATH ("user vars win") — EXCEPT the vars a provider owns for
  // profile isolation, which would silently repoint the session at another
  // login's config tree. Those are dropped and reported rather than applied.
  const { allowed: userAllowed, dropped } = partitionUserEnv(userEnv);
  if (dropped.length > 0) {
    console.warn(
      `Ignoring provider-owned env var(s) for session ${sessionId}: ${dropped.join(', ')} ` +
        '— the pinned profile owns these.',
    );
  }
  Object.assign(env, userAllowed);

  // Conflict detection runs on the user's extra args only — never on the
  // flags Vibeyard itself adds (e.g. its own --session/--resume).
  for (const conflict of findConflictingLaunchFlags(tokenizeArgs(extraArgs))) {
    issues.push(`${conflict.raw}: ${conflict.reason}`);
  }

  if (issues.length > 0) {
    throw new LaunchSpecError(
      'Unsupported launch options for this session:\n' +
        issues.map((issue) => '  - ' + issue).join('\n') +
        '\nRemove the options above and start the session again.',
    );
  }

  return {
    executable: provider.resolveBinaryPath(),
    argv: provider.buildArgs({ sessionId, cliSessionId, isResume, extraArgs, initialPrompt, systemPrompt }),
    env,
    providerId,
    configDir,
    storageMode: 'default',
  };
}

export async function spawnPty(
  sessionId: string,
  cwd: string,
  cliSessionId: string | null,
  isResume: boolean,
  extraArgs: string,
  providerId: ProviderId,
  initialPrompt: string | undefined,
  systemPrompt: string | undefined,
  envVars: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number, pid?: number) => void,
  configDir?: string
): Promise<void> {
  // Resolve the single effective launch spec (executable, argv, env,
  // profile identity, storage mode) before ANY side effect — no session
  // registration, hook install, PTY kill or spawn. Unsupported
  // profile/storage/session options fail here with an actionable message
  // instead of desyncing the child from the transcript readers. The
  // rejection goes through onData + onExit (not a throw) because the
  // renderer fires pty.create without awaiting; the exit callback tears
  // down the watcher/sync state registered for this session.
  let spec: LaunchSpec;
  try {
    spec = resolveLaunchSpec({ sessionId, cliSessionId, isResume, extraArgs, providerId, initialPrompt, systemPrompt, envVars, configDir });
  } catch (err) {
    const message = err instanceof LaunchSpecError ? err.message : `Failed to prepare the launch: ${err}`;
    onData('\r\n\x1b[31m' + message + '\x1b[0m\r\n');
    onExit(1);
    return;
  }

  if (ptys.has(sessionId)) {
    replacedPtys.add(ptys.get(sessionId)!.process);
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

  // Profile support: a Claude session bound to a profile uses an isolated
  // config dir, so Vibeyard's hooks + statusLine (boot-installed into ~/.claude)
  // must also be installed there or cost/activity tracking silently breaks.
  // Fresh profile dirs have no foreign statusLine, so install directly (the
  // guarded/consent flow stays bound to the shared ~/.claude). Both calls are
  // idempotent, mirroring the per-spawn Copilot install above.
  // Guardrail: on macOS, older Claude Code builds reuse a single keychain entry
  // ("Claude Code-credentials") for every config dir, so logging into one
  // profile silently overwrites every other profile's token — the accounts
  // bleed into each other (anthropics/claude-code#20553). Don't spawn a profile
  // session when isolation is known-broken; surface why in the pane and exit
  // rather than running under a config dir whose login isn't actually separate.
  // ('unknown' — a newer build we can't yet confirm — is allowed, never
  // falsely blocked.) The reason is written via onData (not thrown) because the
  // renderer fires pty.create without awaiting, so a throw would be a swallowed
  // rejection leaving a blank pane.
  if (providerId === 'claude' && configDir && getKeychainIsolationStatus().status === 'unsupported') {
    onData(
      '\r\n\x1b[31mClaude profile login isolation is unavailable on this version of Claude Code:\r\n' +
        'all profiles would share one macOS keychain login, mixing the accounts.\r\n' +
        'Update Claude Code, then start the profile session again.\x1b[0m\r\n',
    );
    onExit(1);
    return;
  }

  if (providerId === 'claude' && configDir) {
    try {
      installHooksOnly(configDir);
      installStatusLine(configDir);
    } catch (err) {
      console.warn('Failed to install hooks into profile config dir:', configDir, err);
    }
  }

  const { shell, args: spawnArgs } = resolveWindowsShell(spec.executable, spec.argv);

  const ptyProcess = pty.spawn(shell, spawnArgs, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd,
    env: spec.env,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
    if (replacedPtys.delete(ptyProcess)) return;
    // Only remove from map if this PTY is still the active one for this session
    const current = ptys.get(sessionId);
    if (current?.process === ptyProcess) {
      ptys.delete(sessionId);
    }
    onExit(exitCode, signal, ptyProcess.pid);
  });

  ptys.set(sessionId, { process: ptyProcess, sessionId });
}

// node-pty on Windows throws synchronously from write/resize/kill when the
// underlying child process has already exited (see microsoft/node-pty#887).
// A single dead PTY must not be allowed to crash the main Electron process
// — it would take down every other active session with it. Guard each
// operation, log a warning, and drop the dead handle only when the error
// indicates the PTY is actually dead.

/**
 * True when a node-pty exception means the underlying process has already
 * exited (as opposed to a transient or unknown failure). node-pty emits
 * messages like "Cannot write to a pty that has already exited" / "Cannot
 * resize a pty that has already exited" / "Cannot kill a pty that has
 * already exited" — we only prune the map in that case, so a transient
 * error does not silently leave the session unresponsive.
 */
function isPtyExitedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already exited/i.test(msg);
}

/**
 * Escape sessionId for inclusion in a log message. sessionId arrives from
 * the renderer over IPC, so it is semi-trusted — JSON.stringify neutralises
 * newlines, ANSI escape sequences, and any other control characters that
 * could confuse log output.
 */
function formatSessionIdForLog(sessionId: string): string {
  return JSON.stringify(sessionId);
}

export function writePty(sessionId: string, data: string): void {
  const instance = ptys.get(sessionId);
  if (!instance) return;
  try {
    instance.process.write(data);
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`[pty-manager] writePty(${formatSessionIdForLog(sessionId)}) failed: ${message}`);
    if (isPtyExitedError(err)) {
      ptys.delete(sessionId);
    }
  }
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const instance = ptys.get(sessionId);
  if (!instance) return;
  try {
    instance.process.resize(cols, rows);
  } catch (err) {
    const message = (err as Error).message;
    console.warn(`[pty-manager] resizePty(${formatSessionIdForLog(sessionId)}) failed: ${message}`);
    if (isPtyExitedError(err)) {
      ptys.delete(sessionId);
    }
  }
}

export function killPty(sessionId: string): boolean {
  const instance = ptys.get(sessionId);
  if (!instance) return false;
  let killed = false;
  try {
    instance.process.kill();
    killed = true;
  } catch (err) {
    console.warn(`[pty-manager] killPty(${formatSessionIdForLog(sessionId)}) failed: ${(err as Error).message}`);
  } finally {
    // kill is an intentional teardown — always drop the handle, even on throw.
    ptys.delete(sessionId);
  }
  return killed;
}

export function spawnShellPty(
  sessionId: string,
  cwd: string,
  onData: (data: string) => void,
  onExit: (exitCode: number, signal?: number) => void
): void {
  if (ptys.has(sessionId)) {
    replacedPtys.add(ptys.get(sessionId)!.process);
    killPty(sessionId);
  }

  const shell = isWin
    ? (process.env.COMSPEC || 'cmd.exe')
    : (process.env.SHELL || '/bin/zsh');
  const shellEnv = withUtf8Locale({ ...process.env, PATH: getFullPath() });
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 15,
    cwd,
    env: shellEnv,
  });

  ptyProcess.onData((data) => onData(data));
  ptyProcess.onExit(({ exitCode, signal }) => {
    if (replacedPtys.delete(ptyProcess)) return;
    // Only remove from map if this PTY is still the active one for this session
    const current = ptys.get(sessionId);
    if (current?.process === ptyProcess) {
      ptys.delete(sessionId);
    }
    onExit(exitCode, signal);
  });

  ptys.set(sessionId, { process: ptyProcess, sessionId });
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
