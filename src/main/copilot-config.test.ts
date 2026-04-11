import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

import * as fs from 'fs';
import * as path from 'path';
import { getCopilotConfig } from './copilot-config';

const n = (p: string) => p.replace(/\\/g, '/');

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockStatSync = vi.mocked(fs.statSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
});

describe('getCopilotConfig', () => {
  it('returns empty config when no copilot files exist', () => {
    expect(getCopilotConfig('/project')).toEqual({
      mcpServers: [],
      agents: [],
      skills: [],
      commands: [],
    });
  });

  it('reads MCP servers from user and project mcp-config.json with project override', () => {
    mockReadFileSync.mockImplementation((inputPath) => {
      const filePath = n(String(inputPath));
      if (filePath === '/mock/home/.copilot/mcp-config.json') {
        return JSON.stringify({
          mcpServers: {
            shared: { command: 'user-command' },
            userOnly: { url: 'http://user' },
          },
        }) as any;
      }
      if (filePath === '/project/.copilot/mcp-config.json') {
        return JSON.stringify({
          mcpServers: {
            shared: { url: 'http://project' },
          },
        }) as any;
      }
      throw new Error('ENOENT');
    });

    const config = getCopilotConfig('/project');
    expect(config.mcpServers).toEqual([
      { name: 'shared', url: 'http://project', status: 'configured', scope: 'project', filePath: path.join('/project', '.copilot', 'mcp-config.json') },
      { name: 'userOnly', url: 'http://user', status: 'configured', scope: 'user', filePath: path.join('/mock/home', '.copilot', 'mcp-config.json') },
    ]);
  });

  it('reads agents from ~/.copilot/agents and .github/agents with user precedence', () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = n(String(dirPath));
      if (input === '/mock/home/.copilot/agents') return ['user-only.agent.md', 'shared.agent.md', 'ignored.md'] as any;
      if (input === '/project/.github/agents') return ['project-only.agent.md', 'shared.agent.md'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      const filePath = n(String(inputPath));
      if (filePath === '/mock/home/.copilot/agents/user-only.agent.md') {
        return '---\nname: UserOnly\nmodel: gpt-5\n---\n' as any;
      }
      if (filePath === '/mock/home/.copilot/agents/shared.agent.md') {
        return '---\nname: Shared\nmodel: user-model\n---\n' as any;
      }
      if (filePath === '/project/.github/agents/project-only.agent.md') {
        return '---\nname: ProjectOnly\nmodel: gpt-4o\n---\n' as any;
      }
      if (filePath === '/project/.github/agents/shared.agent.md') {
        return '---\nname: Shared\nmodel: project-model\n---\n' as any;
      }
      throw new Error('ENOENT');
    });

    const config = getCopilotConfig('/project');
    expect(config.agents).toEqual([
      { name: 'UserOnly', model: 'gpt-5', category: 'built-in', scope: 'user', filePath: path.join('/mock/home', '.copilot', 'agents', 'user-only.agent.md') },
      { name: 'Shared', model: 'user-model', category: 'built-in', scope: 'user', filePath: path.join('/mock/home', '.copilot', 'agents', 'shared.agent.md') },
      { name: 'ProjectOnly', model: 'gpt-4o', category: 'built-in', scope: 'project', filePath: path.join('/project', '.github', 'agents', 'project-only.agent.md') },
    ]);
  });

  it('falls back to filename (minus .agent.md) when frontmatter name is missing', () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      if (n(String(dirPath)) === '/mock/home/.copilot/agents') return ['security-auditor.agent.md'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)) === '/mock/home/.copilot/agents/security-auditor.agent.md') {
        return '# no frontmatter here\n' as any;
      }
      throw new Error('ENOENT');
    });

    const config = getCopilotConfig('/project');
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0].name).toBe('security-auditor');
    expect(config.agents[0].model).toBe('');
  });

  it('reads skills from ~/.copilot/skills and .github/skills with user precedence', () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = n(String(dirPath));
      if (input === '/mock/home/.copilot/skills') return ['user-skill', 'shared-skill', '.hidden'] as any;
      if (input === '/project/.github/skills') return ['project-skill', 'shared-skill', 'no-skillmd'] as any;
      throw new Error('ENOENT');
    });
    mockStatSync.mockImplementation((inputPath) => {
      const filePath = n(String(inputPath));
      if (
        filePath === '/mock/home/.copilot/skills/user-skill/SKILL.md' ||
        filePath === '/mock/home/.copilot/skills/shared-skill/SKILL.md' ||
        filePath === '/project/.github/skills/project-skill/SKILL.md' ||
        filePath === '/project/.github/skills/shared-skill/SKILL.md'
      ) {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      const filePath = n(String(inputPath));
      if (filePath === '/mock/home/.copilot/skills/user-skill/SKILL.md') {
        return '---\nname: UserSkill\ndescription: A user skill\n---\n' as any;
      }
      if (filePath === '/mock/home/.copilot/skills/shared-skill/SKILL.md') {
        return '---\nname: Shared\ndescription: User version\n---\n' as any;
      }
      if (filePath === '/project/.github/skills/project-skill/SKILL.md') {
        return '---\nname: ProjectSkill\ndescription: A project skill\n---\n' as any;
      }
      if (filePath === '/project/.github/skills/shared-skill/SKILL.md') {
        return '---\nname: Shared\ndescription: Project version\n---\n' as any;
      }
      throw new Error('ENOENT');
    });

    const config = getCopilotConfig('/project');
    expect(config.skills).toEqual([
      { name: 'UserSkill', description: 'A user skill', scope: 'user', filePath: path.join('/mock/home', '.copilot', 'skills', 'user-skill', 'SKILL.md') },
      { name: 'Shared', description: 'User version', scope: 'user', filePath: path.join('/mock/home', '.copilot', 'skills', 'shared-skill', 'SKILL.md') },
      { name: 'ProjectSkill', description: 'A project skill', scope: 'project', filePath: path.join('/project', '.github', 'skills', 'project-skill', 'SKILL.md') },
    ]);
  });

  it('falls back to directory name when skill frontmatter is missing', () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      if (n(String(dirPath)) === '/mock/home/.copilot/skills') return ['bare-skill'] as any;
      throw new Error('ENOENT');
    });
    mockStatSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)) === '/mock/home/.copilot/skills/bare-skill/SKILL.md') {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)) === '/mock/home/.copilot/skills/bare-skill/SKILL.md') {
        return '# bare skill, no frontmatter\n' as any;
      }
      throw new Error('ENOENT');
    });

    const config = getCopilotConfig('/project');
    expect(config.skills).toEqual([
      { name: 'bare-skill', description: '', scope: 'user', filePath: path.join('/mock/home', '.copilot', 'skills', 'bare-skill', 'SKILL.md') },
    ]);
  });

  it('always returns empty commands (copilot has no custom slash commands)', () => {
    const config = getCopilotConfig('/project');
    expect(config.commands).toEqual([]);
  });
});
