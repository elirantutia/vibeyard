import { vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

import * as fs from 'fs';
import { getGeminiConfig } from './gemini-config';

const mockReadFileSync = vi.mocked(fs.readFileSync);

function mockFiles(files: Record<string, string>): void {
  mockReadFileSync.mockImplementation((p: any) => {
    const content = files[String(p)];
    if (content !== undefined) return content;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getGeminiConfig', () => {
  it('returns empty config when no settings files exist', async () => {
    mockFiles({});

    const config = await getGeminiConfig('/project');
    expect(config).toEqual({ mcpServers: [], agents: [], skills: [], commands: [] });
  });

  it('reads MCP servers from user settings.json', async () => {
    mockFiles({
      '/mock/home/.gemini/settings.json': JSON.stringify({
        mcpServers: {
          github: { command: 'docker', args: ['run', 'ghcr.io/github/github-mcp-server'] },
        },
      }),
    });

    const config = await getGeminiConfig('/project');
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].name).toBe('github');
    expect(config.mcpServers[0].url).toBe('docker');
    expect(config.mcpServers[0].scope).toBe('user');
  });

  it('reads MCP servers from project settings.json', async () => {
    mockFiles({
      '/project/.gemini/settings.json': JSON.stringify({
        mcpServers: {
          slack: { url: 'http://localhost:3000/mcp' },
        },
      }),
    });

    const config = await getGeminiConfig('/project');
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].name).toBe('slack');
    expect(config.mcpServers[0].url).toBe('http://localhost:3000/mcp');
    expect(config.mcpServers[0].scope).toBe('project');
  });

  it('project-level servers override user-level servers by name', async () => {
    mockFiles({
      '/mock/home/.gemini/settings.json': JSON.stringify({
        mcpServers: {
          github: { command: 'docker-user' },
        },
      }),
      '/project/.gemini/settings.json': JSON.stringify({
        mcpServers: {
          github: { command: 'docker-project' },
        },
      }),
    });

    const config = await getGeminiConfig('/project');
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].url).toBe('docker-project');
    expect(config.mcpServers[0].scope).toBe('project');
  });

  it('handles malformed JSON gracefully', async () => {
    mockFiles({
      '/mock/home/.gemini/settings.json': 'not-json',
    });

    const config = await getGeminiConfig('/project');
    expect(config.mcpServers).toHaveLength(0);
  });

  it('handles missing mcpServers key gracefully', async () => {
    mockFiles({
      '/mock/home/.gemini/settings.json': JSON.stringify({ theme: 'dark' }),
    });

    const config = await getGeminiConfig('/project');
    expect(config.mcpServers).toHaveLength(0);
  });

  it('skips servers with no url or command', async () => {
    mockFiles({
      '/mock/home/.gemini/settings.json': JSON.stringify({
        mcpServers: {
          empty: { args: ['--verbose'] },
        },
      }),
    });

    const config = await getGeminiConfig('/project');
    expect(config.mcpServers).toHaveLength(0);
  });

  it('always returns empty agents, skills, and commands', async () => {
    mockFiles({
      '/mock/home/.gemini/settings.json': JSON.stringify({
        mcpServers: {
          test: { command: 'test-cmd' },
        },
      }),
    });

    const config = await getGeminiConfig('/project');
    expect(config.agents).toEqual([]);
    expect(config.skills).toEqual([]);
    expect(config.commands).toEqual([]);
  });
});
