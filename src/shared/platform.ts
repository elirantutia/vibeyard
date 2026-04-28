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

export function samePath(
  a: string | null | undefined,
  b: string | null | undefined,
  caseInsensitive: boolean,
): boolean {
  if (!a || !b) return false;
  const norm = (p: string): string => {
    let n = p.replace(/\\/g, '/');
    if (n.length > 1 && n.endsWith('/')) n = n.slice(0, -1);
    return caseInsensitive ? n.toLowerCase() : n;
  };
  return norm(a) === norm(b);
}
