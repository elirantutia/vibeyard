/**
 * WSL2 integration utilities for the Windows Electron build.
 *
 * Provides detection, distro enumeration, path translation, and command
 * execution helpers so the app can spawn CLI tools inside WSL2 while
 * running as a native Windows process.
 */

import { execSync, execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { isWin } from './platform';

const WSL_EXE = 'wsl.exe';

// ── Caches ──────────────────────────────────────────────────────────

let cachedAvailable: boolean | null = null;
let cachedDistros: string[] | null = null;
let cachedDefaultDistro: string | null = null;
let cachedWslHome = new Map<string, string>();
const pathCache = new Map<string, string>();

export function clearCaches(): void {
  cachedAvailable = null;
  cachedDistros = null;
  cachedDefaultDistro = null;
  cachedWslHome.clear();
  pathCache.clear();
}

// ── Detection ───────────────────────────────────────────────────────

/**
 * Returns true when running on Windows and WSL2 is installed and functional.
 * Result is cached after the first probe.
 */
export function isWslAvailable(): boolean {
  if (!isWin) return false;
  if (cachedAvailable !== null) return cachedAvailable;

  try {
    // `wsl --status` exits 0 when WSL2 is healthy
    execFileSync(WSL_EXE, ['--status'], { timeout: 5000, stdio: 'pipe' });
    cachedAvailable = true;
  } catch {
    cachedAvailable = false;
  }
  return cachedAvailable;
}

// ── Distro listing ──────────────────────────────────────────────────

/**
 * Returns the list of installed WSL distro names.
 * `wsl --list --quiet` outputs one distro per line (UTF-16LE on Windows).
 */
export function getWslDistros(): string[] {
  if (!isWslAvailable()) return [];
  if (cachedDistros) return cachedDistros;

  try {
    const raw = execFileSync(WSL_EXE, ['--list', '--quiet'], {
      timeout: 5000,
      encoding: 'utf16le' as BufferEncoding,
    });
    cachedDistros = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, '').trim())
      .filter(Boolean);
  } catch {
    cachedDistros = [];
  }
  return cachedDistros;
}

/**
 * Returns the default WSL distro (marked with `*` in `wsl --list --verbose`).
 * Falls back to the first distro if parsing fails.
 */
export function getDefaultWslDistro(): string | null {
  if (!isWslAvailable()) return null;
  if (cachedDefaultDistro !== null) return cachedDefaultDistro;

  try {
    const raw = execFileSync(WSL_EXE, ['--list', '--verbose'], {
      timeout: 5000,
      encoding: 'utf16le' as BufferEncoding,
    });
    const lines = raw.split(/\r?\n/).map((l) => l.replace(/\0/g, ''));
    for (const line of lines) {
      const match = line.match(/^\s*\*\s+(\S+)/);
      if (match) {
        cachedDefaultDistro = match[1];
        return cachedDefaultDistro;
      }
    }
  } catch {
    // fall through
  }

  const distros = getWslDistros();
  cachedDefaultDistro = distros[0] ?? null;
  return cachedDefaultDistro;
}

// ── Path translation ────────────────────────────────────────────────

/**
 * If `winPath` is a `\\wsl$\...` or `\\wsl.localhost\...` UNC path, return the
 * Linux absolute path (forward slashes). Otherwise return null.
 */
export function uncWslPathToLinuxPath(winPath: string): string | null {
  const norm = winPath.trim().replace(/\//g, '\\');
  let m = norm.match(/^\\\\wsl\$\\([^\\]+)\\(.*)$/i);
  if (!m) m = norm.match(/^\\\\wsl\.localhost\\([^\\]+)\\(.*)$/i);
  if (!m) return null;
  const tail = m[2].replace(/\\/g, '/');
  if (!tail) return '/';
  return '/' + tail.replace(/^\/+/, '');
}

function collapsePosixPath(p: string): string {
  let s = p.replace(/\/+/g, '/');
  if (s.length > 1) s = s.replace(/\/$/, '');
  return s;
}

/**
 * Normalize a project/root path for persistence when WSL mode is on: store as a
 * single Linux absolute path (`/home/...` or `/mnt/c/...`), never `\\wsl$\...`.
 */
export function normalizeProjectPathForWslStorage(raw: string, distro?: string): string {
  const t = raw.trim();
  if (!t) return t;
  const fromUnc = uncWslPathToLinuxPath(t);
  if (fromUnc !== null) return collapsePosixPath(fromUnc);
  const slash = t.replace(/\\/g, '/');
  if (slash.startsWith('/') && !/^[A-Za-z]:\//.test(slash)) {
    return collapsePosixPath(slash);
  }
  if (t.includes('\\') || /^[A-Za-z]:/.test(t)) {
    return collapsePosixPath(winPathToWsl(t, distro));
  }
  return collapsePosixPath(slash);
}

/**
 * Convert a Windows path to a Linux path inside WSL.
 * e.g. `C:\Users\foo\project` → `/mnt/c/Users/foo/project`
 */
export function winPathToWsl(winPath: string, distro?: string): string {
  const key = `w2l:${distro || ''}:${winPath}`;
  const cached = pathCache.get(key);
  if (cached) return cached;

  const d = distro || getDefaultWslDistro();
  if (!d) return winPath;

  try {
    // `-e` runs wslpath directly; `--` runs via the default shell and breaks on
    // Windows paths with backslash escapes and on Linux paths with `(` `)`.
    const args = ['-d', d, '-e', 'wslpath', '-u', winPath];
    const result = execFileSync(WSL_EXE, args, {
      timeout: 3000,
      encoding: 'utf8',
    }).trim();
    if (result) {
      pathCache.set(key, result);
      return result;
    }
  } catch {
    // Fallback: simple heuristic for common drive letter paths
  }

  const fallback = winPath
    .replace(/^([A-Za-z]):\\/, (_, drive: string) => `/mnt/${drive.toLowerCase()}/`)
    .replace(/\\/g, '/');
  pathCache.set(key, fallback);
  return fallback;
}

/**
 * Convert a Linux path inside WSL to a Windows UNC path.
 * e.g. `/home/foo` → `\\wsl$\Ubuntu\home\foo`
 */
export function wslPathToWin(linuxPath: string, distro?: string): string {
  const key = `l2w:${distro || ''}:${linuxPath}`;
  const cached = pathCache.get(key);
  if (cached) return cached;

  const d = distro || getDefaultWslDistro();
  if (!d) return linuxPath;

  try {
    const args = ['-d', d, '-e', 'wslpath', '-w', linuxPath];
    const result = execFileSync(WSL_EXE, args, {
      timeout: 3000,
      encoding: 'utf8',
    }).trim();
    if (result) {
      pathCache.set(key, result);
      return result;
    }
  } catch {
    // Fallback: manual UNC construction
  }

  // For paths starting with /mnt/<drive>/, convert back to drive letter
  const mntMatch = linuxPath.match(/^\/mnt\/([a-z])\/(.*)/);
  if (mntMatch) {
    const result = `${mntMatch[1].toUpperCase()}:\\${mntMatch[2].replace(/\//g, '\\')}`;
    pathCache.set(key, result);
    return result;
  }

  // For pure Linux paths, use UNC
  const result = `\\\\wsl$\\${d}${linuxPath.replace(/\//g, '\\')}`;
  pathCache.set(key, result);
  return result;
}

// ── WSL home directory ──────────────────────────────────────────────

/**
 * Returns the Linux home directory for the default user in the given distro.
 * Cached per distro.
 */
export function getWslHome(distro?: string): string {
  const d = distro || getDefaultWslDistro() || 'Ubuntu';
  const cached = cachedWslHome.get(d);
  if (cached) return cached;

  try {
    const result = execFileSync(WSL_EXE, ['-d', d, '--', 'sh', '-c', 'echo $HOME'], {
      timeout: 3000,
      encoding: 'utf8',
    }).trim();
    if (result) {
      cachedWslHome.set(d, result);
      return result;
    }
  } catch {
    // fallback
  }

  const fallback = '/root';
  cachedWslHome.set(d, fallback);
  return fallback;
}

/**
 * Returns the Windows UNC path to a file under the WSL user's home.
 * e.g. `getWslHomePath('.claude/settings.json', 'Ubuntu')` →
 *      `\\wsl$\Ubuntu\home\user\.claude\settings.json`
 */
export function getWslHomePath(relativePath: string, distro?: string): string {
  const home = getWslHome(distro);
  const linuxPath = `${home}/${relativePath}`;
  return wslPathToWin(linuxPath, distro);
}

// ── Command execution ───────────────────────────────────────────────

/**
 * Execute a command inside WSL and return its stdout.
 */
export function wslExec(
  command: string,
  args: string[] = [],
  distro?: string,
  options?: { timeout?: number; cwd?: string },
): string {
  const d = distro || getDefaultWslDistro();
  if (!d) throw new Error('No WSL distro available');

  const wslArgs = ['-d', d, '--', command, ...args];
  return execFileSync(WSL_EXE, wslArgs, {
    timeout: options?.timeout ?? 10000,
    encoding: 'utf8',
    cwd: options?.cwd,
  }).trim();
}

/**
 * List directories inside WSL at the given path, optionally filtered by prefix.
 * Used for path autocomplete in the project browser.
 */
export function wslListDirs(dirPath: string, prefix?: string, distro?: string): string[] {
  const d = distro || getDefaultWslDistro();
  if (!d) return [];

  try {
    const pattern = prefix ? `${dirPath}${prefix}*/` : `${dirPath}*/`;
    const raw = wslExec('sh', ['-c', `ls -1d ${pattern} 2>/dev/null || true`], d, { timeout: 3000 });
    return raw
      .split('\n')
      .map((l) => l.trim().replace(/\/$/, ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ── WSL mode helpers ────────────────────────────────────────────────

/**
 * Get the effective WSL distro from preferences, falling back to default.
 */
export function getEffectiveDistro(prefDistro?: string): string | null {
  if (prefDistro) {
    const distros = getWslDistros();
    if (distros.includes(prefDistro)) return prefDistro;
  }
  return getDefaultWslDistro();
}

/**
 * Returns the Windows temp dir as a WSL-accessible path.
 * e.g. `C:\Users\foo\AppData\Local\Temp` → `/mnt/c/Users/foo/AppData/Local/Temp`
 *
 * Used so hook scripts inside WSL write to a location the Windows-side
 * `fs.watch` can observe.
 */
export function getSharedTempDir(distro?: string): string {
  const winTemp = os.tmpdir();
  return winPathToWsl(winTemp, distro);
}
