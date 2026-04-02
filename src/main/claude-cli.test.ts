import { vi } from 'vitest';

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
  tmpdir: () => '/tmp',
}));

import * as fs from 'fs';
import { getClaudeConfig, installHooks } from './claude-cli';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

beforeEach(() => {
  vi.clearAllMocks();
  // Default: all reads/dirs fail (empty state)
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT'); });
});

describe('getClaudeConfig', () => {
  it('returns empty config when no files exist', async () => {
    const config = await getClaudeConfig('/project');
    expect(config).toEqual({ mcpServers: [], agents: [], skills: [], commands: [] });
  });

  it('reads MCP servers from user settings.json', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/mock/home/.claude/settings.json') {
        return JSON.stringify({
          mcpServers: { myServer: { url: 'http://localhost:3000' } },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.mcpServers).toEqual([
      { name: 'myServer', url: 'http://localhost:3000', status: 'configured', scope: 'user', filePath: '/mock/home/.claude/settings.json' },
    ]);
  });

  it('reads MCP servers from project .mcp.json', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/project/.mcp.json') {
        return JSON.stringify({
          mcpServers: { projServer: { command: 'npx server' } },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.mcpServers).toEqual([
      { name: 'projServer', url: 'npx server', status: 'configured', scope: 'project', filePath: '/project/.mcp.json' },
    ]);
  });

  it('project MCP servers override user servers by name', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p === '/mock/home/.claude/settings.json') {
        return JSON.stringify({ mcpServers: { shared: { url: 'user-url' } } });
      }
      if (p === '/project/.claude/settings.json') {
        return JSON.stringify({ mcpServers: { shared: { url: 'project-url' } } });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.mcpServers).toHaveLength(1);
    expect(config.mcpServers[0].url).toBe('project-url');
    expect(config.mcpServers[0].scope).toBe('project');
  });

  it('reads agents from user agents directory', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      if (String(dirPath) === '/mock/home/.claude/agents') {
        return ['my-agent.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/mock/home/.claude/agents/my-agent.md') {
        return '---\nname: MyAgent\nmodel: opus\n---\nContent';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.agents).toEqual([
      { name: 'MyAgent', model: 'opus', category: 'plugin', scope: 'user', filePath: '/mock/home/.claude/agents/my-agent.md' },
    ]);
  });

  it('deduplicates agents by name', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const p = String(dirPath);
      if (p === '/mock/home/.claude/agents' || p === '/project/.claude/agents') {
        return ['agent.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p.endsWith('agent.md')) {
        return '---\nname: SameAgent\nmodel: sonnet\n---\n';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.agents).toHaveLength(1);
  });

  it('reads commands from user commands directory', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      if (String(dirPath) === '/mock/home/.claude/commands') {
        return ['commit.md', 'review.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/mock/home/.claude/commands/commit.md') {
        return '---\ndescription: Create a commit\n---\nContent';
      }
      if (String(filePath) === '/mock/home/.claude/commands/review.md') {
        return 'No frontmatter here';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.commands).toEqual([
      { name: 'commit', description: 'Create a commit', scope: 'user', filePath: '/mock/home/.claude/commands/commit.md' },
      { name: 'review', description: '', scope: 'user', filePath: '/mock/home/.claude/commands/review.md' },
    ]);
  });

  it('reads commands from project commands directory', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      if (String(dirPath) === '/project/.claude/commands') {
        return ['deploy.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/project/.claude/commands/deploy.md') {
        return '---\ndescription: Deploy the app\n---\n';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.commands).toEqual([
      { name: 'deploy', description: 'Deploy the app', scope: 'project', filePath: '/project/.claude/commands/deploy.md' },
    ]);
  });

  it('deduplicates commands by name (project overrides user)', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const p = String(dirPath);
      if (p === '/mock/home/.claude/commands') {
        return ['shared.md'] as unknown as fs.Dirent[];
      }
      if (p === '/project/.claude/commands') {
        return ['shared.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p === '/mock/home/.claude/commands/shared.md') {
        return '---\ndescription: User version\n---\n';
      }
      if (p === '/project/.claude/commands/shared.md') {
        return '---\ndescription: Project version\n---\n';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.commands).toHaveLength(1);
    expect(config.commands[0].description).toBe('Project version');
    expect(config.commands[0].scope).toBe('project');
  });

  it('reads MCP servers from ~/.claude.json top-level (user scope)', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/mock/home/.claude.json') {
        return JSON.stringify({
          mcpServers: { globalServer: { url: 'http://global:3000' } },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.mcpServers).toContainEqual(
      expect.objectContaining({ name: 'globalServer', url: 'http://global:3000', scope: 'user' })
    );
  });

  it('reads project-specific MCP servers from ~/.claude.json projects key', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/mock/home/.claude.json') {
        return JSON.stringify({
          projects: {
            '/project': {
              mcpServers: { localServer: { command: 'npx local' } },
            },
          },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.mcpServers).toContainEqual(
      expect.objectContaining({ name: 'localServer', url: 'npx local', scope: 'project' })
    );
  });

  it('reads managed MCP servers from platform-specific path', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      // On macOS (test environment), the path is /Library/Application Support/ClaudeCode/managed-mcp.json
      if (String(filePath).includes('managed-mcp.json')) {
        return JSON.stringify({
          mcpServers: { managedServer: { url: 'http://managed:3000' } },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.mcpServers).toContainEqual(
      expect.objectContaining({ name: 'managedServer', url: 'http://managed:3000', scope: 'user' })
    );
  });

  it('reads plugin agents when enabled', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p === '/mock/home/.claude/settings.json') {
        return JSON.stringify({ enabledPlugins: { 'my-plugin': true } });
      }
      if (p === '/mock/home/.claude/plugins/installed_plugins.json') {
        return JSON.stringify({
          plugins: {
            'my-plugin': [{ installPath: '/mock/plugins/my-plugin', scope: 'user' }],
          },
        });
      }
      if (p === '/mock/plugins/my-plugin/agents/agent.md') {
        return '---\nname: PluginAgent\nmodel: sonnet\n---\n';
      }
      throw new Error('ENOENT');
    });
    mockReaddirSync.mockImplementation((dirPath) => {
      if (String(dirPath) === '/mock/plugins/my-plugin/agents') {
        return ['agent.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.agents).toContainEqual(
      expect.objectContaining({ name: 'PluginAgent', category: 'plugin', scope: 'user' })
    );
  });

  it('skips disabled plugins', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p === '/mock/home/.claude/settings.json') {
        return JSON.stringify({ enabledPlugins: { 'my-plugin': false } });
      }
      if (p === '/mock/home/.claude/plugins/installed_plugins.json') {
        return JSON.stringify({
          plugins: {
            'my-plugin': [{ installPath: '/mock/plugins/my-plugin' }],
          },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.agents).toEqual([]);
  });

  it('returns empty plugins when enabledPlugins is missing', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      const p = String(filePath);
      if (p === '/mock/home/.claude/settings.json') {
        return JSON.stringify({});
      }
      if (p === '/mock/home/.claude/plugins/installed_plugins.json') {
        return JSON.stringify({
          plugins: {
            'my-plugin': [{ installPath: '/mock/plugins/my-plugin' }],
          },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.agents).toEqual([]);
  });

  it('reads skills from directories', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      if (String(dirPath) === '/mock/home/.claude/skills') {
        return ['my-skill'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/mock/home/.claude/skills/my-skill/SKILL.md') {
        return '---\nname: MySkill\ndescription: Does stuff\n---\n';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.skills).toEqual([
      { name: 'MySkill', description: 'Does stuff', scope: 'user', filePath: '/mock/home/.claude/skills/my-skill/SKILL.md' },
    ]);
  });
});

describe('installHooks', () => {
  it('writes hooks to settings.json', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    expect(mockMkdirSync).toHaveBeenCalledWith('/mock/home/.claude', { recursive: true });
    // installHooks calls installHooksOnly (write 1) + installStatusLine (write 2)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);

    // First write contains hooks
    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    expect(written.hooks).toBeDefined();
    expect(written.hooks.UserPromptSubmit).toBeDefined();
    expect(written.hooks.Stop).toBeDefined();
    expect(written.hooks.PermissionRequest).toBeDefined();
    expect(written.hooks.SessionStart).toBeDefined();

    // Second write adds statusLine
    const withStatusLine = JSON.parse(String(mockWriteFileSync.mock.calls[1][1]));
    expect(withStatusLine.statusLine).toBeDefined();
    expect(withStatusLine.statusLine.type).toBe('command');
  });

  it('preserves existing non-vibeyard hooks', () => {
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/mock/home/.claude/settings.json') {
        return JSON.stringify({
          hooks: {
            UserPromptSubmit: [{
              matcher: '',
              hooks: [{ type: 'command', command: 'echo user-hook' }],
            }],
          },
        });
      }
      throw new Error('ENOENT');
    });

    installHooks();

    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    const promptHooks = written.hooks.UserPromptSubmit;
    // Should have the existing user hook matcher + the new vibeyard matcher
    expect(promptHooks.length).toBe(2);
    const userHook = promptHooks.find((m: { hooks: Array<{ command: string }> }) =>
      m.hooks.some((h: { command: string }) => h.command === 'echo user-hook')
    );
    expect(userHook).toBeDefined();
  });

  it('removes old vibeyard hooks before installing new ones', () => {
    mockReadFileSync.mockImplementation((filePath) => {
      if (String(filePath) === '/mock/home/.claude/settings.json') {
        return JSON.stringify({
          hooks: {
            Stop: [{
              matcher: '',
              hooks: [{ type: 'command', command: 'echo waiting # vibeyard-hook' }],
            }],
          },
        });
      }
      throw new Error('ENOENT');
    });

    installHooks();

    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    // The old vibeyard hook should be replaced, not duplicated
    const stopHooks = written.hooks.Stop;
    const vibeyardHookCount = stopHooks.reduce((count: number, m: { hooks: Array<{ command: string }> }) =>
      count + m.hooks.filter((h: { command: string }) => h.command.includes('# vibeyard-hook')).length, 0
    );
    // Should have exactly 2 vibeyard hooks (status hook + inspector event capture hook)
    expect(vibeyardHookCount).toBe(2);
  });

  it('installs all 25 hook events (7 core + 18 inspector-only)', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    const hookEvents = Object.keys(written.hooks);

    // Core 7 hooks
    const coreEvents = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'PermissionRequest'];
    for (const event of coreEvents) {
      expect(hookEvents).toContain(event);
    }

    // Inspector-only 18 hooks
    const inspectorEvents = [
      'PreToolUse', 'SubagentStart', 'SubagentStop', 'Notification',
      'PreCompact', 'PostCompact', 'SessionEnd', 'TaskCreated', 'TaskCompleted',
      'WorktreeCreate', 'WorktreeRemove', 'CwdChanged', 'FileChanged',
      'ConfigChange', 'Elicitation', 'ElicitationResult', 'InstructionsLoaded',
      'TeammateIdle',
    ];
    for (const event of inspectorEvents) {
      expect(hookEvents).toContain(event);
    }

    expect(hookEvents).toHaveLength(25);

    // Core hooks should have status writer + event logger (at least 2 hooks)
    for (const event of coreEvents) {
      const matchers = written.hooks[event];
      const allHooks = matchers.flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks);
      expect(allHooks.some((h: { command: string }) => h.command.includes('.status'))).toBe(true);
      expect(allHooks.some((h: { command: string }) => h.command.includes('.events'))).toBe(true);
    }

    // PostToolUseFailure should include dedicated tool failure capture
    const failureHooks = written.hooks.PostToolUseFailure
      .flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks);
    expect(failureHooks.some((h: { command: string }) =>
      h.command.includes('.toolfailure') && h.command.includes('d.get(\\"error\\"')
    )).toBe(true);

    // PostToolUse event cmd should write .toolfailure for error results (is_error: true)
    const toolUseHooks = written.hooks.PostToolUse
      .flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks);
    expect(toolUseHooks.some((h: { command: string }) =>
      h.command.includes('.toolfailure') && h.command.includes('is_error')
    )).toBe(true);

    // Inspector-only hooks should have only event logger (no status writer)
    for (const event of inspectorEvents) {
      const matchers = written.hooks[event];
      const allHooks = matchers.flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks);
      expect(allHooks.some((h: { command: string }) => h.command.includes('.status'))).toBe(false);
      expect(allHooks.some((h: { command: string }) => h.command.includes('.events'))).toBe(true);
    }
  });
});
