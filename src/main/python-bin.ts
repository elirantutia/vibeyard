/**
 * Resolves the Python interpreter that Vibeyard's generated hook, statusLine
 * and vibeyard-ctl wrappers invoke.
 *
 * On POSIX the interpreter is looked up on the login-shell PATH
 * (`getFullPath`), so NixOS/Guix (no `/usr/bin/python3` at all), Homebrew
 * etc. work; `/usr/bin/python3` is only the fallback.
 *
 * The chosen path is baked into settings.json hook commands that every CLI
 * session runs, long after this process exits, so the search prefers a
 * *stable* interpreter:
 *  - Paths are kept as found, without resolving symlinks: on Nix,
 *    `/run/current-system/sw/bin/python3` is a stable link into a store path
 *    that changes on every upgrade.
 *  - Version-manager shims (`.../shims`: pyenv, asdf, mise) pick a version
 *    from the hook's cwd, i.e. the project, and fail when its pinned version
 *    isn't installed; `/nix/store`/`/gnu/store` paths and an active
 *    venv/conda env come from a transient shell (nix-shell, direnv, an
 *    activated venv) and vanish with it. These are used only when nothing
 *    stable is on PATH.
 *  - On a Mac without the Command Line Tools, `/usr/bin/python3` is Apple's
 *    stub, which opens an install dialog and exits non-zero. It is skipped so
 *    a later PATH entry (e.g. Homebrew) wins even when `/usr/bin` comes first.
 *
 * Windows keeps the bare `python` command (PATH lookup happens in cmd.exe).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, execSync } from 'child_process';
import { getFullPath } from './shell-path';
import { isMac, isWin, pathSep } from './platform';

const FALLBACK_POSIX_PYTHON = '/usr/bin/python3';

let cached: string | null = null;
let cachedHasCommandLineTools: boolean | undefined;

function isExecutableFile(p: string): boolean {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** True for Apple's `/usr/bin/python3` stub (no Command Line Tools / Xcode). */
function isMacPythonStub(p: string): boolean {
  if (!isMac || p !== FALLBACK_POSIX_PYTHON) return false;
  if (cachedHasCommandLineTools === undefined) {
    try {
      execFileSync('/usr/bin/xcode-select', ['-p'], { timeout: 3000, stdio: 'pipe' });
      cachedHasCommandLineTools = true;
    } catch {
      cachedHasCommandLineTools = false;
    }
  }
  return !cachedHasCommandLineTools;
}

function isTransientDir(dir: string): boolean {
  if (path.basename(dir) === 'shims') return true;
  if (dir.startsWith('/nix/store/') || dir.startsWith('/gnu/store/')) return true;
  return [process.env.VIRTUAL_ENV, process.env.CONDA_PREFIX].some(
    (env) => !!env && dir === path.join(env, 'bin'),
  );
}

function findPython3OnPath(envPath: string): string | null {
  let transient: string | null = null;
  for (const dir of envPath.split(pathSep)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, 'python3');
    if (!isExecutableFile(candidate) || isMacPythonStub(candidate)) continue;
    if (!isTransientDir(dir)) return candidate;
    transient ??= candidate;
  }
  return transient;
}

/** Interpreter path/command for generated scripts. Resolved once per process. */
export function getPythonBin(): string {
  if (cached) return cached;
  if (isWin) return (cached = 'python');
  return (cached = findPython3OnPath(getFullPath()) ?? FALLBACK_POSIX_PYTHON);
}

/**
 * `getPythonBin()` as a token safe to splice into a POSIX shell command line.
 * Left bare when it holds only path-safe characters (the common case), so
 * existing command strings don't change; otherwise single-quoted.
 */
export function getPythonCmd(): string {
  const bin = getPythonBin();
  if (/^[A-Za-z0-9_\/.+-]+$/.test(bin)) return bin;
  return `'${bin.replace(/'/g, `'\\''`)}'`;
}

/**
 * Whether the resolved interpreter can actually run. On POSIX this is checked
 * without executing it (running Apple's stub would pop the CLT install dialog).
 */
export function isPythonUsable(): boolean {
  const bin = getPythonBin();
  if (isWin) {
    // Through a shell, like the hooks themselves: a pyenv-win `python.bat`
    // shim is invisible to a shell-less exec.
    try {
      execSync(`${bin} --version`, { timeout: 3000, stdio: 'pipe', windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
  return isExecutableFile(bin) && !isMacPythonStub(bin);
}

export function _resetForTesting(): void {
  cached = null;
  cachedHasCommandLineTools = undefined;
}
