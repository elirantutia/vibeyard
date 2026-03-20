import * as path from 'path';
import type { ReadinessCategory, ReadinessCheck } from '../../../shared/types';
import type { ReadinessChecker } from '../types';
import { fileExists, dirExists, readFileSafe, buildCategory } from '../utils';

function checkClaudeMdExists(projectPath: string): ReadinessCheck {
  const exists = fileExists(path.join(projectPath, 'CLAUDE.md'));
  return {
    id: 'claude-md-exists',
    name: 'CLAUDE.md exists',
    status: exists ? 'pass' : 'fail',
    description: exists ? 'CLAUDE.md found' : 'No CLAUDE.md file found. This is the primary way to give AI agents context about your project.',
    score: exists ? 100 : 0,
    maxScore: 100,
    fixPrompt: exists ? undefined : 'Create a CLAUDE.md file for this project. Analyze the codebase and generate a comprehensive CLAUDE.md that includes: project description, build/run commands, test commands, architecture overview, key file locations, and coding conventions. Make it thorough but concise (50-300 lines).',
  };
}

function checkClaudeMdBuildCommands(content: string | null): ReadinessCheck {
  if (!content) {
    return {
      id: 'claude-md-build',
      name: 'CLAUDE.md has build commands',
      status: 'fail',
      description: 'CLAUDE.md missing — cannot check for build commands.',
      score: 0,
      maxScore: 100,
    };
  }
  const hasBuild = /\b(build|compile|run|start|dev|npm run|yarn |pnpm |make|cargo |go build|gradle|mvn)\b/i.test(content);
  return {
    id: 'claude-md-build',
    name: 'CLAUDE.md has build commands',
    status: hasBuild ? 'pass' : 'fail',
    description: hasBuild ? 'Build/run commands documented' : 'No build or run commands found in CLAUDE.md.',
    score: hasBuild ? 100 : 0,
    maxScore: 100,
    fixPrompt: hasBuild ? undefined : 'Update the CLAUDE.md file to include build and run commands. Add a "Build & Run" section with the exact commands needed to build and run this project.',
  };
}

function checkClaudeMdTestCommands(content: string | null): ReadinessCheck {
  if (!content) {
    return {
      id: 'claude-md-test',
      name: 'CLAUDE.md has test commands',
      status: 'fail',
      description: 'CLAUDE.md missing — cannot check for test commands.',
      score: 0,
      maxScore: 100,
    };
  }
  const hasTest = /\b(test|spec|jest|vitest|pytest|mocha|rspec|cargo test|go test|npm test|yarn test)\b/i.test(content);
  return {
    id: 'claude-md-test',
    name: 'CLAUDE.md has test commands',
    status: hasTest ? 'pass' : 'fail',
    description: hasTest ? 'Test commands documented' : 'No test commands found in CLAUDE.md.',
    score: hasTest ? 100 : 0,
    maxScore: 100,
    fixPrompt: hasTest ? undefined : 'Update the CLAUDE.md file to include test commands. Add a "Testing" section with the exact commands needed to run tests in this project.',
  };
}

function checkClaudeMdArchitecture(content: string | null): ReadinessCheck {
  if (!content) {
    return {
      id: 'claude-md-architecture',
      name: 'CLAUDE.md has architecture section',
      status: 'fail',
      description: 'CLAUDE.md missing — cannot check for architecture documentation.',
      score: 0,
      maxScore: 100,
    };
  }
  const hasArch = /\b(architecture|overview|structure|description|design|data flow|components)\b/i.test(content);
  return {
    id: 'claude-md-architecture',
    name: 'CLAUDE.md has architecture section',
    status: hasArch ? 'pass' : 'fail',
    description: hasArch ? 'Architecture/overview documented' : 'No architecture or project overview found in CLAUDE.md.',
    score: hasArch ? 100 : 0,
    maxScore: 100,
    fixPrompt: hasArch ? undefined : 'Update the CLAUDE.md file to include an architecture overview. Add an "Architecture" section describing the project structure, key components, data flow, and important design decisions.',
  };
}

function checkClaudeMdSize(content: string | null): ReadinessCheck {
  if (!content) {
    return {
      id: 'claude-md-size',
      name: 'CLAUDE.md appropriate size',
      status: 'fail',
      description: 'CLAUDE.md missing.',
      score: 0,
      maxScore: 100,
    };
  }
  const lines = content.split('\n').length;
  let status: ReadinessCheck['status'];
  let score: number;
  let description: string;

  if (lines >= 50 && lines <= 300) {
    status = 'pass';
    score = 100;
    description = `CLAUDE.md is ${lines} lines — good size.`;
  } else if ((lines >= 10 && lines < 50) || (lines > 300 && lines <= 500)) {
    status = 'warning';
    score = 50;
    description = lines < 50
      ? `CLAUDE.md is only ${lines} lines — consider adding more detail.`
      : `CLAUDE.md is ${lines} lines — consider trimming for focus.`;
  } else {
    status = 'fail';
    score = 0;
    description = lines < 10
      ? `CLAUDE.md is only ${lines} lines — too short to be useful.`
      : `CLAUDE.md is ${lines} lines — too long, may waste context window.`;
  }

  let fixPrompt: string | undefined;
  if (status !== 'pass') {
    fixPrompt = lines < 50
      ? 'The CLAUDE.md file is too short. Expand it to include comprehensive project documentation (aim for 50-300 lines) covering: build commands, test commands, architecture, key files, and conventions.'
      : 'The CLAUDE.md file is too long (over 300 lines). Trim it to focus on the most important information for AI agents. Move detailed documentation to separate files and keep CLAUDE.md between 50-300 lines.';
  }

  return {
    id: 'claude-md-size',
    name: 'CLAUDE.md appropriate size',
    status,
    description,
    score,
    maxScore: 100,
    fixPrompt,
  };
}

function checkCursorRules(projectPath: string): ReadinessCheck {
  const hasFile = fileExists(path.join(projectPath, '.cursorrules'));
  const hasDir = dirExists(path.join(projectPath, '.cursor', 'rules'));
  const exists = hasFile || hasDir;
  return {
    id: 'cursor-rules',
    name: '.cursorrules or .cursor/rules/',
    status: exists ? 'pass' : 'fail',
    description: exists ? 'Cursor rules found' : 'No .cursorrules file or .cursor/rules/ directory found.',
    score: exists ? 100 : 0,
    maxScore: 100,
    fixPrompt: exists ? undefined : 'Create a .cursorrules file for this project. Analyze the codebase and create rules that guide Cursor AI about project conventions, preferred patterns, and things to avoid.',
  };
}

function checkAgentsMd(projectPath: string): ReadinessCheck {
  const exists = fileExists(path.join(projectPath, 'AGENTS.md'));
  return {
    id: 'agents-md',
    name: 'AGENTS.md',
    status: exists ? 'pass' : 'fail',
    description: exists ? 'AGENTS.md found' : 'No AGENTS.md file found.',
    score: exists ? 100 : 0,
    maxScore: 100,
    fixPrompt: exists ? undefined : 'Create an AGENTS.md file for this project. This file guides AI coding agents about project-specific workflows, testing requirements, and code review standards.',
  };
}

function checkCopilotInstructions(projectPath: string): ReadinessCheck {
  const exists = fileExists(path.join(projectPath, '.github', 'copilot-instructions.md'));
  return {
    id: 'copilot-instructions',
    name: '.github/copilot-instructions.md',
    status: exists ? 'pass' : 'fail',
    description: exists ? 'Copilot instructions found' : 'No .github/copilot-instructions.md file found.',
    score: exists ? 100 : 0,
    maxScore: 100,
    fixPrompt: exists ? undefined : 'Create a .github/copilot-instructions.md file for this project. This file provides GitHub Copilot with project-specific context and coding guidelines.',
  };
}

export const aiInstructionsChecker: ReadinessChecker = {
  id: 'ai-instructions',
  name: 'AI Instructions',
  weight: 0.5,

  async analyze(projectPath: string): Promise<ReadinessCategory> {
    const claudeMdContent = readFileSafe(path.join(projectPath, 'CLAUDE.md'));

    const checks = [
      checkClaudeMdExists(projectPath),
      checkClaudeMdBuildCommands(claudeMdContent),
      checkClaudeMdTestCommands(claudeMdContent),
      checkClaudeMdArchitecture(claudeMdContent),
      checkClaudeMdSize(claudeMdContent),
      checkCursorRules(projectPath),
      checkAgentsMd(projectPath),
      checkCopilotInstructions(projectPath),
    ];

    return buildCategory(this.id, this.name, this.weight, checks);
  },
};
