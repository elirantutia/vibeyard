import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import picomatch from 'picomatch';
import type { ReadinessCategory, ReadinessCheck } from '../../../shared/types';
import type { ReadinessChecker } from '../types';
import { fileExists, readFileSafe, countFileLines, buildCategory } from '../utils';

const DEFAULT_SCAN_IGNORE = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Gemfile.lock',
  'Cargo.lock',
  'composer.lock',
  'poetry.lock',
  'go.sum',
  'Pipfile.lock',
  '*.min.js',
  '*.min.css',
  '*.bundle.js',
  '*.generated.*',
];

const CCIDEIGNORE_HEADER = `# Files and patterns to exclude from AI readiness large-file scanning.
# One pattern per line. Supports glob syntax (e.g. *.min.js, src/**/*.generated.ts).
# Lines starting with # are comments.

`;

function ensureCcideignore(projectPath: string): void {
  const filePath = path.join(projectPath, '.ccideignore');
  if (fileExists(filePath)) return;
  try {
    fs.writeFileSync(filePath, CCIDEIGNORE_HEADER + DEFAULT_SCAN_IGNORE.join('\n') + '\n', 'utf-8');
  } catch {
    // Ignore write errors (e.g. read-only filesystem)
  }
}

function loadScanIgnorePatterns(projectPath: string): string[] {
  const patterns: string[] = [];
  const content = readFileSafe(path.join(projectPath, '.ccideignore'));
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

function getTrackedFiles(projectPath: string): string[] {
  try {
    const output = execSync('git ls-files', { cwd: projectPath, encoding: 'utf-8', timeout: 5000 });
    return output.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function checkClaudeMdNotBloated(projectPath: string): ReadinessCheck {
  const content = readFileSafe(path.join(projectPath, 'CLAUDE.md'));
  if (!content) {
    return {
      id: 'claude-md-bloat',
      name: 'CLAUDE.md not bloated',
      status: 'pass',
      description: 'No CLAUDE.md to check for bloat (checked in AI Instructions).',
      score: 100,
      maxScore: 100,
    };
  }
  const lines = content.split('\n').length;
  if (lines <= 300) {
    return { id: 'claude-md-bloat', name: 'CLAUDE.md not bloated', status: 'pass', description: `CLAUDE.md is ${lines} lines — within limits.`, score: 100, maxScore: 100 };
  }
  if (lines <= 500) {
    return {
      id: 'claude-md-bloat', name: 'CLAUDE.md not bloated', status: 'warning', description: `CLAUDE.md is ${lines} lines — getting large.`, score: 50, maxScore: 100,
      fixPrompt: 'The CLAUDE.md file is getting large. Review it and move detailed documentation to separate files. Keep CLAUDE.md focused on essential context that AI agents need for every interaction.',
    };
  }
  return {
    id: 'claude-md-bloat', name: 'CLAUDE.md not bloated', status: 'fail', description: `CLAUDE.md is ${lines} lines — too large, wastes context window.`, score: 0, maxScore: 100,
    fixPrompt: 'The CLAUDE.md file is too large and wastes AI context window space. Aggressively trim it: move detailed docs to separate files, remove redundant information, and keep only the most critical context. Target under 300 lines.',
  };
}

// Matched against basenames of tracked files
const SENSITIVE_FILE_PATTERNS = [
  '.env', '.env.*',
  '*.pem', '*.key', '*.p12', '*.pfx', '*.jks', '*.keystore',
  '*.credentials', 'credentials.json', 'credentials.yaml', 'credentials.yml',
  'service-account*.json',
  '*.secret', 'secrets.yaml', 'secrets.yml', 'secrets.json',
  '*secret*.json', '*secret*.yaml', '*secret*.yml',
  '.npmrc', '.pypirc',
  'token.json', 'tokens.json',
  '.htpasswd', 'shadow',
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa',
];

// Matched against full relative paths of tracked files
const SENSITIVE_PATH_PATTERNS = [
  '.docker/config.json',
  '**/.docker/config.json',
];

const sensitiveBasenameMatcher = picomatch(SENSITIVE_FILE_PATTERNS, { basename: true });
const sensitivePathMatcher = picomatch(SENSITIVE_PATH_PATTERNS);

function findSensitiveFiles(trackedFiles: string[]): string[] {
  return trackedFiles.filter(f => sensitiveBasenameMatcher(path.basename(f)) || sensitivePathMatcher(f));
}

function checkClaudeignore(projectPath: string, trackedFiles: string[]): ReadinessCheck {
  const exists = fileExists(path.join(projectPath, '.claudeignore'));
  const fileCount = trackedFiles.length;
  const sensitiveFiles = findSensitiveFiles(trackedFiles);

  // Even small projects need .claudeignore if they have sensitive files
  if (sensitiveFiles.length > 0 && !exists) {
    const listed = sensitiveFiles.slice(0, 5).join(', ');
    const extra = sensitiveFiles.length > 5 ? ` and ${sensitiveFiles.length - 5} more` : '';
    return {
      id: 'claudeignore',
      name: '.claudeignore exists',
      status: 'fail',
      description: `No .claudeignore and project contains sensitive files: ${listed}${extra}. These may expose secrets to AI context.`,
      score: 0,
      maxScore: 100,
      fixPrompt: `Create a .claudeignore file for this project. The following files likely contain secrets and should be excluded from AI context: ${sensitiveFiles.join(', ')}. Also consider excluding other sensitive or irrelevant files.`,
    };
  }

  // Small projects don't need .claudeignore (no sensitive files at this point)
  if (fileCount > 0 && fileCount < 200) {
    return {
      id: 'claudeignore',
      name: '.claudeignore exists',
      status: 'pass',
      description: exists ? '.claudeignore found' : `Project has only ${fileCount} tracked files — .claudeignore not needed.`,
      score: 100,
      maxScore: 100,
    };
  }

  return {
    id: 'claudeignore',
    name: '.claudeignore exists',
    status: exists ? 'pass' : 'fail',
    description: exists
      ? '.claudeignore found'
      : `No .claudeignore file and project has ${fileCount > 0 ? fileCount : 'many'} tracked files. Large projects benefit from excluding irrelevant files.`,
    score: exists ? 100 : 0,
    maxScore: 100,
    fixPrompt: exists ? undefined : 'Create a .claudeignore file for this project. Analyze which files and directories are irrelevant to AI coding tasks (generated files, large data files, vendor directories, etc.) and add them to .claudeignore to keep the AI context window focused.',
  };
}

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

  ensureCcideignore(projectPath);
  const ignorePatterns = loadScanIgnorePatterns(projectPath);
  const matchBasename = picomatch(ignorePatterns, { basename: true });
  const matchFullPath = picomatch(ignorePatterns);
  const isIgnored = (file: string) => matchBasename(file) || matchFullPath(file);

  const largeFiles: string[] = [];
  const LINE_THRESHOLD = 5000;
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
    return { id: 'large-files', name: 'No extremely large files', status: 'pass', description: 'No tracked files exceed 5000 lines.', score: 100, maxScore: 100 };
  }
  if (count <= 3) {
    return {
      id: 'large-files', name: 'No extremely large files', status: 'warning',
      description: `${count} file(s) over 5000 lines: ${largeFiles.slice(0, 3).join(', ')}. Edit .ccideignore to exclude files from scanning.`,
      score: 50, maxScore: 100,
      fixPrompt: `These files are very large and may consume excessive AI context: ${largeFiles.join(', ')}. Consider splitting them into smaller, focused modules.`,
    };
  }
  return {
    id: 'large-files', name: 'No extremely large files', status: 'fail',
    description: `${count} files over 5000 lines. Edit .ccideignore to exclude files from scanning.`,
    score: 0, maxScore: 100,
    fixPrompt: `${count} files exceed 5000 lines: ${largeFiles.slice(0, 5).join(', ')}. Large files waste AI context and make changes harder. Refactor them into smaller, focused modules.`,
  };
}

export const contextOptimizationChecker: ReadinessChecker = {
  id: 'context-optimization',
  name: 'Context Optimization',
  weight: 0.2,

  async analyze(projectPath: string): Promise<ReadinessCategory> {
    const trackedFiles = getTrackedFiles(projectPath);

    const checks = [
      checkClaudeMdNotBloated(projectPath),
      checkClaudeignore(projectPath, trackedFiles),
      checkLargeFiles(projectPath, trackedFiles),
    ];

    return buildCategory(this.id, this.name, this.weight, checks);
  },
};
