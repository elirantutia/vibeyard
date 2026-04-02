import * as path from 'path';
import * as fs from 'fs';
import picomatch from 'picomatch';
import type { ReadinessCheck } from '../../../shared/types';
import type { ReadinessCheckProducer, TaggedCheck, AnalysisContext } from '../types';
import { fileExists, readFileSafe, countFileLines } from '../utils';
import { DEFAULT_SCAN_IGNORE } from '../../../shared/constants';

const VIBEYARDIGNORE_HEADER = `# Files and patterns to exclude from AI readiness large-file scanning.
# One pattern per line. Supports glob syntax (e.g. *.min.js, src/**/*.generated.ts).
# Lines starting with # are comments.

`;

function ensureVibeyardignore(projectPath: string): void {
  const filePath = path.join(projectPath, '.vibeyardignore');
  if (fileExists(filePath)) return;
  try {
    fs.writeFileSync(filePath, VIBEYARDIGNORE_HEADER + DEFAULT_SCAN_IGNORE.join('\n') + '\n', 'utf-8');
  } catch {
    // Ignore write errors (e.g. read-only filesystem)
  }
}

function loadScanIgnorePatterns(projectPath: string): string[] {
  const patterns: string[] = [];
  const content = readFileSafe(path.join(projectPath, '.vibeyardignore'));
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

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.m', '.mm',
  '.json', '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.scss',
  '.md', '.txt', '.sql', '.sh', '.bash', '.zsh',
]);

function checkLargeFiles(projectPath: string, trackedFiles: string[]): ReadinessCheck {
  if (trackedFiles.length === 0) {
    return {
      id: 'large-files',
      name: 'No extremely large files',
      status: 'pass',
      description: 'No tracked files to check (not a git repo or empty).',
      score: 100,
      maxScore: 100,
    };
  }

  ensureVibeyardignore(projectPath);
  const ignorePatterns = loadScanIgnorePatterns(projectPath);
  const matchBasename = picomatch(ignorePatterns, { basename: true });
  const matchFullPath = picomatch(ignorePatterns);
  const isIgnored = (file: string) => matchBasename(file) || matchFullPath(file);

  const largeFiles: string[] = [];
  const LINE_THRESHOLD = 2000;
  const CHECK_LIMIT = 500;

  let checked = 0;
  for (const file of trackedFiles) {
    if (checked >= CHECK_LIMIT) break;
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    if (isIgnored(file)) continue;
    checked++;

    try {
      const fullPath = path.join(projectPath, file);
      const lines = countFileLines(fullPath);
      if (lines > LINE_THRESHOLD) {
        largeFiles.push(`${file} (${lines} lines)`);
      }
    } catch {
      // Skip unreadable files
    }
  }

  const count = largeFiles.length;
  if (count === 0) {
    return { id: 'large-files', name: 'No extremely large files', status: 'pass', description: 'No tracked files exceed 2000 lines.', score: 100, maxScore: 100 };
  }
  if (count <= 3) {
    return {
      id: 'large-files', name: 'No extremely large files', status: 'warning',
      description: `${count} file(s) over 2000 lines: ${largeFiles.slice(0, 3).join(', ')}. Edit .vibeyardignore to exclude files from scanning.`,
      score: 50, maxScore: 100,
      fixPrompt: `These files are very large and may consume excessive AI context: ${largeFiles.join(', ')}. Split them into smaller, focused modules.`,
    };
  }
  return {
    id: 'large-files', name: 'No extremely large files', status: 'fail',
    description: `${count} files over 2000 lines. Edit .vibeyardignore to exclude files from scanning.`,
    score: 0, maxScore: 100,
    fixPrompt: `${count} files exceed 2000 lines: ${largeFiles.slice(0, 5).join(', ')}. Large files waste AI context and make changes harder. Refactor them into smaller, focused modules.`,
  };
}

export const genericContextProducer: ReadinessCheckProducer = {
  produce(projectPath: string, ctx: AnalysisContext): TaggedCheck[] {
    return [{ category: 'context', check: checkLargeFiles(projectPath, ctx.trackedFiles) }];
  },
};
