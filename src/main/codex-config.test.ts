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
import { getCodexConfig } from './codex-config';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockStatSync = vi.mocked(fs.statSync);

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
});

describe('getCodexConfig', () => {
  it('returns empty config when no codex files exist', async () => {
    await expect(getCodexConfig('/project')).resolves.toEqual({
      mcpServers: [],
      agents: [],
      skills: [],
      commands: [],
    });
  });

  it('reads MCP servers from user and project config.toml with project override', async () => {
    mockReadFileSync.mockImplementation((inputPath) => {
      const filePath = String(inputPath);
      if (filePath === '/mock/home/.codex/config.toml') {
        return `
[mcp_servers.shared]
command = "user-command"

[mcp_servers.userOnly]
url = "http://user"
` as any;
      }
      if (filePath === '/project/.codex/config.toml') {
        return `
[mcp_servers.shared]
url = "http://project"
` as any;
      }
      throw new Error('ENOENT');
    });

    const config = await getCodexConfig('/project');
    expect(config.mcpServers).toEqual([
      { name: 'shared', url: 'http://project', status: 'configured', scope: 'project', filePath: '/project/.codex/config.toml' },
      { name: 'userOnly', url: 'http://user', status: 'configured', scope: 'user', filePath: '/mock/home/.codex/config.toml' },
    ]);
  });

  it('reads agents from user and project .codex directories', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = String(dirPath);
      if (input === '/mock/home/.codex/agents') return ['user-agent.md'] as any;
      if (input === '/project/.codex/agents') return ['project-agent.md'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      const filePath = String(inputPath);
      if (filePath === '/mock/home/.codex/agents/user-agent.md') {
        return '---\nname: UserAgent\nmodel: gpt-5.4\n---\n' as any;
      }
      if (filePath === '/project/.codex/agents/project-agent.md') {
        return '---\nname: ProjectAgent\nmodel: gpt-5.4-mini\n---\n' as any;
      }
      throw new Error('ENOENT');
    });

    const config = await getCodexConfig('/project');
    expect(config.agents).toEqual([
      { name: 'UserAgent', model: 'gpt-5.4', category: 'plugin', scope: 'user', filePath: '/mock/home/.codex/agents/user-agent.md' },
      { name: 'ProjectAgent', model: 'gpt-5.4-mini', category: 'plugin', scope: 'project', filePath: '/project/.codex/agents/project-agent.md' },
    ]);
  });

  it('deduplicates agent and skill names by first scope found', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = String(dirPath);
      if (input === '/mock/home/.codex/agents' || input === '/project/.codex/agents') return ['shared.md'] as any;
      if (input === '/mock/home/.codex/skills' || input === '/project/.codex/skills') return ['shared-skill'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      const filePath = String(inputPath);
      if (filePath.endsWith('/agents/shared.md')) {
        return '---\nname: SharedAgent\nmodel: gpt-5.4\n---\n' as any;
      }
      if (filePath.endsWith('/skills/shared-skill/SKILL.md')) {
        return '---\nname: SharedSkill\ndescription: Shared desc\n---\n' as any;
      }
      throw new Error('ENOENT');
    });
    mockStatSync.mockImplementation((inputPath) => {
      const filePath = String(inputPath);
      if (filePath.endsWith('/skills/shared-skill/SKILL.md')) {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    const config = await getCodexConfig('/project');
    expect(config.agents).toHaveLength(1);
    expect(config.agents[0].scope).toBe('user');
    expect(config.skills).toHaveLength(1);
    expect(config.skills[0].scope).toBe('user');
  });

  it('reads skills and ignores hidden or invalid entries', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = String(dirPath);
      if (input === '/mock/home/.codex/skills') return ['valid-skill', '.system', 'missing-skill'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      if (String(inputPath) === '/mock/home/.codex/skills/valid-skill/SKILL.md') {
        return '---\nname: ValidSkill\ndescription: Useful\n---\n' as any;
      }
      throw new Error('ENOENT');
    });
    mockStatSync.mockImplementation((inputPath) => {
      if (String(inputPath) === '/mock/home/.codex/skills/valid-skill/SKILL.md') {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    const config = await getCodexConfig('/project');
    expect(config.skills).toEqual([
      { name: 'ValidSkill', description: 'Useful', scope: 'user', filePath: '/mock/home/.codex/skills/valid-skill/SKILL.md' },
    ]);
  });
});
