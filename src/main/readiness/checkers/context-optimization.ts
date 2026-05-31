import * as path from 'path';
import * as fs from 'fs';
import type { ReadinessCheck } from '../../../shared/types';
import type { ReadinessCheckProducer, TaggedCheck, AnalysisContext } from '../types';
import { fileExists, countFileLines } from '../utils';
import { DEFAULT_SCAN_IGNORE } from '../../../shared/constants';
import { buildVibeyardignoreMatcher } from '../../vibeyardignore';
import { buildSplitFilesPrompt } from '../../../shared/split-file-prompt';

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
  const isIgnored = buildVibeyardignoreMatcher(projectPath);

  const largeFiles: string[] = [];
  const LINE_THRESHOLD = 1000;
  const MAX_FILES_SCANNED = 500;

  let checked = 0;
  for (const file of trackedFiles) {
    if (checked >= MAX_FILES_SCANNED) break;
    const ext = path.extname(file).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) continue;
    if (isIgnored(file)) continue;
    checked++;

    try {
      const fullPath = path.join(projectPath, file);
      const lines = countFileLines(fullPath, LINE_THRESHOLD);
      if (lines > LINE_THRESHOLD) {
        largeFiles.push(`${file} (${LINE_THRESHOLD}+ lines)`);
      }
    } catch {
      // Skip unreadable files
    }
  }

  const largeFilesRationale = 'Files with thousands of lines bloat the context window, slowing the AI and inflating costs. Excluding generated artifacts via .vibeyardignore — and refactoring genuine giants — leaves more room for the source code the AI actually needs to reason about.';

  const count = largeFiles.length;
  if (count === 0) {
    return { id: 'large-files', name: 'No extremely large files', status: 'pass', description: `No tracked files exceed ${LINE_THRESHOLD} lines.`, score: 100, maxScore: 100, effort: 'medium', impact: 80, rationale: largeFilesRationale };
  }
  if (count <= 3) {
    return {
      id: 'large-files', name: 'No extremely large files', status: 'warning',
      description: `${count} file(s) over ${LINE_THRESHOLD} lines: ${largeFiles.slice(0, 3).join(', ')}. Edit .vibeyardignore to exclude files from scanning.`,
      score: 50, maxScore: 100,
      fixPrompt: buildSplitFilesPrompt(largeFiles),
      effort: 'medium', impact: 65, rationale: largeFilesRationale,
    };
  }
  return {
    id: 'large-files', name: 'No extremely large files', status: 'fail',
    description: `${count} files over ${LINE_THRESHOLD} lines. Edit .vibeyardignore to exclude files from scanning.`,
    score: 0, maxScore: 100,
    fixPrompt: `${count} files exceed ${LINE_THRESHOLD} lines: ${largeFiles.slice(0, 5).join(', ')}. Large files waste AI context and make changes harder. Refactor them into smaller, focused modules.`,
    effort: 'high', impact: 80, rationale: largeFilesRationale,
  };
}

export const genericContextProducer: ReadinessCheckProducer = {
  produce(projectPath: string, ctx: AnalysisContext): TaggedCheck[] {
    return [{ category: 'context', check: checkLargeFiles(projectPath, ctx.trackedFiles) }];
  },
};
