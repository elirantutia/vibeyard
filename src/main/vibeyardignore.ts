import * as path from 'path';
import picomatch from 'picomatch';
import { readFileSafe } from './fs-utils';
import { DEFAULT_SCAN_IGNORE } from '../shared/constants';

/**
 * Reads `.vibeyardignore` from a project root and returns its active glob
 * patterns (blank lines and `#` comments stripped). When the file is absent,
 * built-in exclusions apply in memory without creating a project file.
 */
export function loadScanIgnorePatterns(projectPath: string): string[] {
  const patterns: string[] = [];
  const content = readFileSafe(path.join(projectPath, '.vibeyardignore'));
  if (content === null) return [...DEFAULT_SCAN_IGNORE];
  if (content) {
    for (const raw of content.split('\n')) {
      const line = raw.trim();
      if (line && !line.startsWith('#')) {
        patterns.push(line);
      }
    }
  }
  return patterns;
}

/**
 * Builds a predicate that reports whether a project-relative path is excluded
 * by the project's `.vibeyardignore`. Patterns are matched against both the
 * basename (e.g. `*.min.js`) and the full relative path (e.g. a glob under
 * `src/`). When there are no patterns, the predicate is a constant `false`
 * (nothing is ignored).
 */
export function buildVibeyardignoreMatcher(projectPath: string): (relPath: string) => boolean {
  const patterns = loadScanIgnorePatterns(projectPath);
  if (patterns.length === 0) return () => false;
  const matchBasename = picomatch(patterns, { basename: true });
  const matchFullPath = picomatch(patterns);
  return (relPath: string) => matchBasename(relPath) || matchFullPath(relPath);
}
