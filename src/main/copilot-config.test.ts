import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

import * as fs from 'fs';
import { getCopilotConfig } from './copilot-config';

const n = (p: string) => p.replace(/\\/g, '/');

const mockReadFileSync = vi.mocked(fs.readFileSync);

function mockFiles(rawFiles: Record<string, string>): void {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFiles)) files[n(k)] = v;
  mockReadFileSync.mockImplementation((p: any) => {
    const content = files[n(String(p))];
    if (content !== undefined) return content;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
});

describe('getCopilotConfig', () => {
  it('returns empty config when no config files exist', async () => {
    mockFiles({});

    const config = await getCopilotConfig('/project');
    expect(config).toEqual({ mcpServers: [], agents: [], skills: [], commands: [] });
  });

  it('reads MCP servers from user mcp-config.json', async () => {
    mockFiles({
      '/mock/home/.copilot/mcp-config.json': JSON.stringify({
        mcpServers: {
          github: { command: 'docker', args: ['run', 'ghcr.io/github/github-mcp-server'] },
        },
      }),
    });

    const config = await getCopilotConfig('/project');
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].name).toBe('github');
    expect(config.mcpServers[0].url).toBe('docker');
    expect(config.mcpServers[0].scope).toBe('user');
  });

  it('reads MCP servers with url field from mcp-config.json', async () => {
    mockFiles({
      '/mock/home/.copilot/mcp-config.json': JSON.stringify({
        mcpServers: {
          slack: { url: 'http://localhost:3000/mcp' },
        },
      }),
    });

    const config = await getCopilotConfig('/project');
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].name).toBe('slack');
    expect(config.mcpServers[0].url).toBe('http://localhost:3000/mcp');
    expect(config.mcpServers[0].scope).toBe('user');
  });

  it('prefers url over command when both are present', async () => {
    mockFiles({
      '/mock/home/.copilot/mcp-config.json': JSON.stringify({
        mcpServers: {
          mixed: { url: 'http://remote', command: 'local-cmd' },
        },
      }),
    });

    const config = await getCopilotConfig('/project');
    expect(config.mcpServers[0].url).toBe('http://remote');
  });

  it('skips servers with no url or command', async () => {
    mockFiles({
      '/mock/home/.copilot/mcp-config.json': JSON.stringify({
        mcpServers: {
          empty: { args: ['--verbose'] },
        },
      }),
    });

    const config = await getCopilotConfig('/project');
    expect(config.mcpServers).toHaveLength(0);
  });

  it('handles malformed JSON gracefully', async () => {
    mockFiles({
      '/mock/home/.copilot/mcp-config.json': 'not-json',
    });

    const config = await getCopilotConfig('/project');
    expect(config.mcpServers).toHaveLength(0);
  });

  it('handles missing mcpServers key gracefully', async () => {
    mockFiles({
      '/mock/home/.copilot/mcp-config.json': JSON.stringify({ version: '1.0' }),
    });

    const config = await getCopilotConfig('/project');
    expect(config.mcpServers).toHaveLength(0);
  });

  it('always returns empty agents, skills, and commands', async () => {
    mockFiles({
      '/mock/home/.copilot/mcp-config.json': JSON.stringify({
        mcpServers: {
          test: { command: 'test-cmd' },
        },
      }),
    });

    const config = await getCopilotConfig('/project');
    expect(config.agents).toEqual([]);
    expect(config.skills).toEqual([]);
    expect(config.commands).toEqual([]);
  });

  it('ignores project path — only user-level config is read', async () => {
    mockFiles({
      '/mock/home/.copilot/mcp-config.json': JSON.stringify({
        mcpServers: { user: { url: 'http://user' } },
      }),
    });

    // Even with a different project path, same result
    const config1 = await getCopilotConfig('/project/a');
    const config2 = await getCopilotConfig('/project/b');
    expect(config1.mcpServers).toHaveLength(1);
    expect(config2.mcpServers).toHaveLength(1);
    expect(config1.mcpServers[0].scope).toBe('user');
    expect(config2.mcpServers[0].scope).toBe('user');
  });
});
