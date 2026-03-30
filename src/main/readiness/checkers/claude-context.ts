import * as path from 'path';
import picomatch from 'picomatch';
import type { ReadinessCheck } from '../../../shared/types';
import type { ReadinessCheckProducer, TaggedCheck, AnalysisContext } from '../types';
import { fileExists } from '../utils';
import { checkNotBloated } from './instruction-file-checks';

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

export const claudeContextProducer: ReadinessCheckProducer = {
  providerId: 'claude',

  produce(projectPath: string, ctx: AnalysisContext): TaggedCheck[] {
    return [
      checkNotBloated(projectPath, { fileName: 'CLAUDE.md', idPrefix: 'claude-md', displayName: 'CLAUDE.md' }),
      checkClaudeignore(projectPath, ctx.trackedFiles),
    ].map(check => ({ category: 'context', check }));
  },
};
