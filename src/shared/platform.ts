// Cross-platform path utils — pure JS, no Node.js APIs.

export function lastSeparatorIndex(filePath: string): number {
  return Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
}

export function isAbsolutePath(filePath: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(filePath);
}

export function joinPath(basePath: string, childPath: string): string {
  if (!basePath) return childPath;
  if (!childPath) return basePath;

  const normalizedChild = childPath.replace(/^[\\/]+/, '');
  if (basePath.endsWith('/') || basePath.endsWith('\\')) {
    return basePath + normalizedChild;
  }

  const separator = basePath.includes('\\') ? '\\' : '/';
  return `${basePath}${separator}${normalizedChild}`;
}

export function basename(filePath: string): string {
  const trimmed = filePath.endsWith('/') || filePath.endsWith('\\')
    ? filePath.slice(0, -1)
    : filePath;
  const i = lastSeparatorIndex(trimmed);
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}
