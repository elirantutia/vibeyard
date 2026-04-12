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
import { getOpenCodeConfig } from './opencode-config';

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

describe('getOpenCodeConfig', () => {
  it('returns empty config when no opencode files exist', async () => {
    await expect(getOpenCodeConfig('/project')).resolves.toEqual({
      mcpServers: [],
      agents: [],
      skills: [],
      commands: [],
    });
  });

  it('reads MCP servers from user and project opencode.json with project override', async () => {
    const userConfig = { mcp: { shared: { command: 'user-cmd' }, userOnly: { url: 'http://user' } } };
    const projectConfig = { mcp: { shared: { url: 'http://project' } } };

    mockReadFileSync.mockImplementation((inputPath) => {
      const fp = n(String(inputPath));
      if (fp === '/mock/home/.config/opencode/opencode.json') return JSON.stringify(userConfig) as any;
      if (fp === '/project/opencode.json') return JSON.stringify(projectConfig) as any;
      throw new Error('ENOENT');
    });

    const config = await getOpenCodeConfig('/project');
    expect(config.mcpServers).toEqual([
      { name: 'shared', url: 'http://project', status: 'configured', scope: 'project', filePath: path.join('/project', 'opencode.json') },
      { name: 'userOnly', url: 'http://user', status: 'configured', scope: 'user', filePath: path.join('/mock/home', '.config', 'opencode', 'opencode.json') },
    ]);
  });

  it('reads MCP command as url when url not present', async () => {
    const config = { mcp: { myserver: { type: 'stdio', command: 'npx -y @my/server' } } };
    mockReadFileSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)) === '/project/opencode.json') return JSON.stringify(config) as any;
      throw new Error('ENOENT');
    });

    const result = await getOpenCodeConfig('/project');
    expect(result.mcpServers).toEqual([
      { name: 'myserver', url: 'npx -y @my/server', status: 'configured', scope: 'project', filePath: path.join('/project', 'opencode.json') },
    ]);
  });

  it('reads agents from user opencode.json agent key', async () => {
    const config = { agent: { build: { model: 'anthropic/claude-sonnet-4-5' }, plan: { model: 'anthropic/claude-haiku-4-5' } } };
    mockReadFileSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)) === '/mock/home/.config/opencode/opencode.json') return JSON.stringify(config) as any;
      throw new Error('ENOENT');
    });

    const result = await getOpenCodeConfig('/project');
    expect(result.agents).toEqual([
      { name: 'build', model: 'anthropic/claude-sonnet-4-5', category: 'built-in', scope: 'user', filePath: path.join('/mock/home', '.config', 'opencode', 'opencode.json') },
      { name: 'plan', model: 'anthropic/claude-haiku-4-5', category: 'built-in', scope: 'user', filePath: path.join('/mock/home', '.config', 'opencode', 'opencode.json') },
    ]);
  });

  it('reads agents from .opencode/agents markdown files', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = n(String(dirPath));
      if (input === '/project/.opencode/agents') return ['review.md'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      const fp = n(String(inputPath));
      if (fp === '/project/.opencode/agents/review.md') {
        return '---\nname: review\nmodel: anthropic/claude-sonnet-4-5\n---\nReview agent\n' as any;
      }
      throw new Error('ENOENT');
    });

    const result = await getOpenCodeConfig('/project');
    expect(result.agents).toEqual([
      { name: 'review', model: 'anthropic/claude-sonnet-4-5', category: 'plugin', scope: 'project', filePath: path.join('/project', '.opencode', 'agents', 'review.md') },
    ]);
  });

  it('deduplicates agents by name — user wins over project', async () => {
    const userConfig = { agent: { shared: { model: 'anthropic/claude-opus-4-5' } } };
    const projectConfig = { agent: { shared: { model: 'anthropic/claude-haiku-4-5' } } };
    mockReadFileSync.mockImplementation((inputPath) => {
      const fp = n(String(inputPath));
      if (fp === '/mock/home/.config/opencode/opencode.json') return JSON.stringify(userConfig) as any;
      if (fp === '/project/opencode.json') return JSON.stringify(projectConfig) as any;
      throw new Error('ENOENT');
    });

    const result = await getOpenCodeConfig('/project');
    expect(result.agents).toHaveLength(1);
    expect(result.agents[0].model).toBe('anthropic/claude-opus-4-5');
    expect(result.agents[0].scope).toBe('user');
  });

  it('reads skills from .opencode/skills subdirectories', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = n(String(dirPath));
      if (input === '/project/.opencode/skills') return ['git-release'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)) === '/project/.opencode/skills/git-release/SKILL.md') {
        return '---\nname: git-release\ndescription: Create consistent releases\n---\n' as any;
      }
      throw new Error('ENOENT');
    });
    mockStatSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)) === '/project/.opencode/skills/git-release/SKILL.md') {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    const result = await getOpenCodeConfig('/project');
    expect(result.skills).toEqual([
      { name: 'git-release', description: 'Create consistent releases', scope: 'project', filePath: path.join('/project', '.opencode', 'skills', 'git-release', 'SKILL.md') },
    ]);
  });

  it('reads commands from .opencode/commands markdown files', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = n(String(dirPath));
      if (input === '/project/.opencode/commands') return ['test.md'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)) === '/project/.opencode/commands/test.md') {
        return '---\nname: run-tests\ndescription: Run the test suite\n---\n' as any;
      }
      throw new Error('ENOENT');
    });

    const result = await getOpenCodeConfig('/project');
    expect(result.commands).toEqual([
      { name: 'run-tests', description: 'Run the test suite', scope: 'project', filePath: path.join('/project', '.opencode', 'commands', 'test.md') },
    ]);
  });

  it('deduplicates skills — user wins over project', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const input = n(String(dirPath));
      if (input === '/mock/home/.config/opencode/skills' || input === '/project/.opencode/skills') return ['shared'] as any;
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)).endsWith('/skills/shared/SKILL.md')) {
        return '---\nname: shared\ndescription: Shared skill\n---\n' as any;
      }
      throw new Error('ENOENT');
    });
    mockStatSync.mockImplementation((inputPath) => {
      if (n(String(inputPath)).endsWith('/skills/shared/SKILL.md')) {
        return { isFile: () => true } as any;
      }
      throw new Error('ENOENT');
    });

    const result = await getOpenCodeConfig('/project');
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].scope).toBe('user');
  });
});
