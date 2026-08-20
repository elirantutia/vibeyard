// Cross-platform path utils — pure JS, no Node.js APIs.

export function lastSeparatorIndex(filePath: string): number {
  return Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
}

export function isAbsolutePath(filePath: string): boolean {
  if (!filePath) return false;
  if (filePath.startsWith('/') || filePath.startsWith('\\')) return true;
  return /^[a-zA-Z]:[\\/]/.test(filePath);
}

export function basename(filePath: string): string {
  const trimmed = filePath.endsWith('/') || filePath.endsWith('\\')
    ? filePath.slice(0, -1)
    : filePath;
  const i = lastSeparatorIndex(trimmed);
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

export function dirname(filePath: string): string {
  const trimmed = filePath.length > 1 && (filePath.endsWith('/') || filePath.endsWith('\\'))
    ? filePath.slice(0, -1)
    : filePath;
  const i = lastSeparatorIndex(trimmed);
  if (i === -1) return '.';
  if (i === 0) return trimmed.slice(0, 1); // root: '/' or '\'
  return trimmed.slice(0, i);
}

/**
 * Split off the part of `baseDir` that `..` must never climb past: a POSIX
 * root, a Windows drive, or a UNC share. Popping any of those off would turn
 * an absolute path into a relative one, which the fs IPC would then resolve
 * against the main-process cwd instead of the intended root.
 * Returns a prefix that already ends in `sep` (empty when the base is relative).
 */
function rootPrefix(baseDir: string, sep: string): { prefix: string; rest: string } {
  const unc = /^[\\/]{2}([^\\/]+)[\\/]+([^\\/]+)(?=[\\/]|$)/.exec(baseDir);
  if (unc) return { prefix: `${sep}${sep}${unc[1]}${sep}${unc[2]}${sep}`, rest: baseDir.slice(unc[0].length) };

  const drive = /^[a-zA-Z]:(?=[\\/])/.exec(baseDir);
  if (drive) return { prefix: drive[0] + sep, rest: baseDir.slice(drive[0].length) };

  if (/^[\\/]/.test(baseDir)) return { prefix: sep, rest: baseDir };
  return { prefix: '', rest: baseDir };
}

/**
 * Resolve a relative path against a base directory, collapsing `.` and `..`
 * segments. Separator-agnostic: the base's own separator style is preserved so
 * the result stays comparable to the paths the rest of the app passes around.
 * `..` that would climb past the root is clamped at the root.
 */
export function resolveRelativePath(baseDir: string, relative: string): string {
  const sep = baseDir.includes('\\') && !baseDir.includes('/') ? '\\' : '/';
  const { prefix, rest } = rootPrefix(baseDir, sep);
  const parts: string[] = [];

  for (const segment of [...rest.split(/[\\/]/), ...relative.split(/[\\/]/)]) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }

  return prefix + parts.join(sep);
}

/** True when `child` is `parent` itself or nested anywhere beneath it. */
export function isPathUnder(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + '/') || child.startsWith(parent + '\\');
}

/**
 * Compare two paths for equality ignoring separator style (`/` vs `\`). The file
 * watcher emits OS-native paths (via the watcher backend) while some callers
 * build paths by string concatenation that can mix separators on Windows, so a
 * raw `===` is unreliable across platforms.
 */
export function samePath(a: string, b: string): boolean {
  if (a === b) return true;
  return a.replace(/\\/g, '/') === b.replace(/\\/g, '/');
}
