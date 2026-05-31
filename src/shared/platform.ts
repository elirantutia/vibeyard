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
