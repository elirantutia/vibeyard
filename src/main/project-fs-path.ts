import * as path from 'path';
import { expandUserPath } from './fs-utils';
import { isWin, isWslMode } from './platform';
import { loadState } from './store';
import { getEffectiveDistro, normalizeProjectPathForWslStorage, wslPathToWin } from './wsl';

function wslDistro(): string | undefined {
  return getEffectiveDistro(loadState().preferences.wslDistro) ?? undefined;
}

/**
 * Stored project path (POSIX under WSL, or native path) → path Node `fs` can use
 * on Windows (UNC for Linux-side trees).
 */
export function storedPathToMainFs(storedPath: string): string {
  if (!isWin || !isWslMode(loadState().preferences)) {
    return storedPath;
  }
  const norm = storedPath.replace(/\\/g, '/');
  if (norm.startsWith('/')) {
    return wslPathToWin(norm, wslDistro());
  }
  return storedPath;
}

/**
 * Join a stored project root with path segments; returns a path usable with
 * `fs.*` and `shell.openPath` on Windows under WSL mode.
 */
export function joinStoredProjectPath(storedRoot: string, ...segments: string[]): string {
  if (!isWin || !isWslMode(loadState().preferences)) {
    return path.join(storedRoot, ...segments);
  }
  const root = storedRoot.replace(/\\/g, '/');
  const combined = path.posix.join(root, ...segments.map((x) => x.replace(/\\/g, '/')));
  if (combined.startsWith('/')) {
    return wslPathToWin(combined, wslDistro());
  }
  return path.join(storedRoot, ...segments);
}

/** Resolve a path string for main-process `fs` (handles POSIX `/...` under WSL mode). */
export function resolvePathForMainProcess(filePath: string): string {
  let x = expandUserPath(filePath);
  if (isWin && isWslMode(loadState().preferences)) {
    const s = x.replace(/\\/g, '/');
    if (s.startsWith('/')) {
      x = storedPathToMainFs(s);
    }
  }
  return path.resolve(x);
}

/** True if `resolvedAbsolute` is the project root or a file under it. */
/** Project root as a path `fs.watch` / `readdir` can use on Windows under WSL mode. */
export function projectRootForFsWatch(projectPath: string): string {
  const n = projectPath.replace(/\\/g, '/');
  if (isWin && isWslMode(loadState().preferences) && n.startsWith('/')) {
    return storedPathToMainFs(n);
  }
  return path.resolve(projectPath);
}

/**
 * True when two stored project roots refer to the same tree (e.g. `/home/u/p` vs `\\wsl$\Ubuntu\home\u\p`).
 */
export function storedProjectPathsEquivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const distro =
    isWin && isWslMode(loadState().preferences)
      ? getEffectiveDistro(loadState().preferences.wslDistro) ?? undefined
      : undefined;
  return normalizeProjectPathForWslStorage(a, distro) === normalizeProjectPathForWslStorage(b, distro);
}

export function pathIsWithinStoredProject(resolvedAbsolute: string, storedProjectPath: string): boolean {
  if (isWin && isWslMode(loadState().preferences) && storedProjectPath.replace(/\\/g, '/').startsWith('/')) {
    const base = storedPathToMainFs(storedProjectPath).replace(/\//g, '\\').toLowerCase();
    const rel = resolvedAbsolute.replace(/\//g, '\\').toLowerCase();
    return rel === base || rel.startsWith(base + '\\');
  }
  const rp = path.resolve(resolvedAbsolute);
  const sp = path.resolve(storedProjectPath);
  return rp === sp || rp.startsWith(sp + path.sep);
}
