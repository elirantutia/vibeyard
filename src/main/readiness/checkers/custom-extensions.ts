import * as path from 'path';
import type { ReadinessCategory, ReadinessCheck } from '../../../shared/types';
import type { ReadinessChecker } from '../types';
import { dirExists, readDirSafe, buildCategory } from '../utils';

function checkCustomCommands(projectPath: string): ReadinessCheck {
  const commandsDir = path.join(projectPath, '.claude', 'commands');
  const files = readDirSafe(commandsDir).filter(f => f.endsWith('.md'));
  const has = files.length > 0;
  return {
    id: 'custom-commands',
    name: 'Custom commands',
    status: has ? 'pass' : 'fail',
    description: has ? `${files.length} custom command(s) found` : 'No custom commands in .claude/commands/.',
    score: has ? 100 : 0,
    maxScore: 100,
    fixPrompt: has ? undefined : 'Create custom slash commands for this project. Create .claude/commands/ directory and add .md files that define reusable prompts for common tasks like code review, testing, deployment, etc. Each file becomes a /project:<command-name> slash command.',
  };
}

function checkCustomSkills(projectPath: string): ReadinessCheck {
  const skillsDir = path.join(projectPath, '.claude', 'skills');
  let has = false;
  if (dirExists(skillsDir)) {
    const entries = readDirSafe(skillsDir);
    has = entries.some(e => dirExists(path.join(skillsDir, e)));
  }
  return {
    id: 'custom-skills',
    name: 'Custom skills',
    status: has ? 'pass' : 'fail',
    description: has ? 'Custom skills found' : 'No custom skills in .claude/skills/.',
    score: has ? 100 : 0,
    maxScore: 100,
    fixPrompt: has ? undefined : 'Create custom skills for this project. Create .claude/skills/ directory with subdirectories, each containing a skill definition that extends Claude\'s capabilities for project-specific tasks.',
  };
}

function checkCustomAgents(projectPath: string): ReadinessCheck {
  const agentsDir = path.join(projectPath, '.claude', 'agents');
  const files = readDirSafe(agentsDir).filter(f => f.endsWith('.md'));
  const has = files.length > 0;
  return {
    id: 'custom-agents',
    name: 'Custom agents',
    status: has ? 'pass' : 'fail',
    description: has ? `${files.length} custom agent(s) found` : 'No custom agents in .claude/agents/.',
    score: has ? 100 : 0,
    maxScore: 100,
    fixPrompt: has ? undefined : 'Create custom agent definitions for this project. Create .claude/agents/ directory and add .md files that define specialized agents for tasks like testing, code review, or deployment.',
  };
}

export const customExtensionsChecker: ReadinessChecker = {
  id: 'custom-extensions',
  name: 'Custom Extensions',
  weight: 0.3,

  async analyze(projectPath: string): Promise<ReadinessCategory> {
    const checks = [
      checkCustomCommands(projectPath),
      checkCustomSkills(projectPath),
      checkCustomAgents(projectPath),
    ];

    return buildCategory(this.id, this.name, this.weight, checks);
  },
};
