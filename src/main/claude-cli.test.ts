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

vi.mock('./providers/resolve-binary', () => ({
  resolveBinary: vi.fn(() => '/mock/bin/claude'),
  validateBinaryExists: vi.fn(() => true),
}));

vi.mock('./providers/claude-version', () => ({
  getClaudeVersion: vi.fn(() => '999.999.999'),
}));

vi.mock('./hook-commands', () => ({
  installHookScripts: vi.fn(),
  installEventScript: vi.fn(),
  statusCmd: vi.fn((e: string, s: string, _v: string, marker: string) => `echo ${e}:${s} > .status ${marker}`),
  stopStatusCmd: vi.fn((_v: string, marker: string) => `stop_status_writer .subagents > .status ${marker}`),
  captureSessionIdCmd: vi.fn((_v: string, marker: string) => `capture-sessionid .sessionid ${marker}`),
  captureToolFailureCmd: vi.fn((_v: string, marker: string) => `capture-toolfailure .toolfailure ${marker}`),
  wrapPythonHookCmd: vi.fn((_name: string, _code: string, marker: string) => `capture-event .events ${marker}`),
}));

import * as fs from 'fs';
import * as path from 'path';
import { getClaudeConfig, installHooks, installHooksOnly, installStatusLine, _resetWrittenSettings } from './claude-cli';
import { installEventScript } from './hook-commands';
import { getClaudeVersion } from './providers/claude-version';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

// Normalize paths for cross-platform comparison
const n = (p: string) => p.replace(/\\/g, '/');

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the settings-write content cache so each test's first write is not
  // deduplicated away by a write from a prior test.
  _resetWrittenSettings();
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
      if (n(String(filePath)) === '/mock/home/.claude/settings.json') {
        return JSON.stringify({
          mcpServers: { myServer: { url: 'http://localhost:3000' } },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.mcpServers).toEqual([
      { name: 'myServer', url: 'http://localhost:3000', status: 'configured', scope: 'user', filePath: path.join('/mock/home', '.claude', 'settings.json') },
    ]);
  });

  it('reads MCP servers from project .mcp.json', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      if (n(String(filePath)) === '/project/.mcp.json') {
        return JSON.stringify({
          mcpServers: { projServer: { command: 'npx server' } },
        });
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.mcpServers).toEqual([
      { name: 'projServer', url: 'npx server', status: 'configured', scope: 'project', filePath: path.join('/project', '.mcp.json') },
    ]);
  });

  it('project MCP servers override user servers by name', async () => {
    mockReadFileSync.mockImplementation((filePath) => {
      const p = n(String(filePath));
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
      if (n(String(dirPath)) === '/mock/home/.claude/agents') {
        return ['my-agent.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      if (n(String(filePath)) === '/mock/home/.claude/agents/my-agent.md') {
        return '---\nname: MyAgent\nmodel: opus\n---\nContent';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.agents).toEqual([
      { name: 'MyAgent', model: 'opus', category: 'plugin', scope: 'user', filePath: path.join('/mock/home', '.claude', 'agents', 'my-agent.md') },
    ]);
  });

  it('deduplicates agents by name', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const p = n(String(dirPath));
      if (p === '/mock/home/.claude/agents' || p === '/project/.claude/agents') {
        return ['agent.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      const p = n(String(filePath));
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
      if (n(String(dirPath)) === '/mock/home/.claude/commands') {
        return ['commit.md', 'review.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      if (n(String(filePath)) === '/mock/home/.claude/commands/commit.md') {
        return '---\ndescription: Create a commit\n---\nContent';
      }
      if (n(String(filePath)) === '/mock/home/.claude/commands/review.md') {
        return 'No frontmatter here';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.commands).toEqual([
      { name: 'commit', description: 'Create a commit', scope: 'user', filePath: path.join('/mock/home', '.claude', 'commands', 'commit.md') },
      { name: 'review', description: '', scope: 'user', filePath: path.join('/mock/home', '.claude', 'commands', 'review.md') },
    ]);
  });

  it('reads commands from project commands directory', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      if (n(String(dirPath)) === '/project/.claude/commands') {
        return ['deploy.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      if (n(String(filePath)) === '/project/.claude/commands/deploy.md') {
        return '---\ndescription: Deploy the app\n---\n';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.commands).toEqual([
      { name: 'deploy', description: 'Deploy the app', scope: 'project', filePath: path.join('/project', '.claude', 'commands', 'deploy.md') },
    ]);
  });

  it('deduplicates commands by name (project overrides user)', async () => {
    mockReaddirSync.mockImplementation((dirPath) => {
      const p = n(String(dirPath));
      if (p === '/mock/home/.claude/commands') {
        return ['shared.md'] as unknown as fs.Dirent[];
      }
      if (p === '/project/.claude/commands') {
        return ['shared.md'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      const p = n(String(filePath));
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
      if (n(String(filePath)) === '/mock/home/.claude.json') {
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
      if (n(String(filePath)) === '/mock/home/.claude.json') {
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
      const p = n(String(filePath));
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
      if (n(String(dirPath)) === '/mock/plugins/my-plugin/agents') {
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
      const p = n(String(filePath));
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
      const p = n(String(filePath));
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
      if (n(String(dirPath)) === '/mock/home/.claude/skills') {
        return ['my-skill'] as unknown as fs.Dirent[];
      }
      throw new Error('ENOENT');
    });
    mockReadFileSync.mockImplementation((filePath) => {
      if (n(String(filePath)) === '/mock/home/.claude/skills/my-skill/SKILL.md') {
        return '---\nname: MySkill\ndescription: Does stuff\n---\n';
      }
      throw new Error('ENOENT');
    });

    const config = await getClaudeConfig('/project');
    expect(config.skills).toEqual([
      { name: 'MySkill', description: 'Does stuff', scope: 'user', filePath: path.join('/mock/home', '.claude', 'skills', 'my-skill', 'SKILL.md') },
    ]);
  });
});

describe('install into a profile config dir', () => {
  const profileDir = path.join('/mock/home', '.vibeyard', 'profiles', 'work');

  it('installHooksOnly writes to the given config dir, not ~/.claude', () => {
    installHooksOnly(profileDir);
    expect(mockMkdirSync).toHaveBeenCalledWith(profileDir, { recursive: true });
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(n(String(mockWriteFileSync.mock.calls[0][0]))).toBe(n(path.join(profileDir, 'settings.json')));
    // Default ~/.claude/settings.json must not be touched.
    const touchedDefault = mockWriteFileSync.mock.calls.some(
      (c) => n(String(c[0])) === '/mock/home/.claude/settings.json',
    );
    expect(touchedDefault).toBe(false);
  });

  it('installStatusLine writes to the given config dir', () => {
    installStatusLine(profileDir);
    expect(n(String(mockWriteFileSync.mock.calls[0][0]))).toBe(n(path.join(profileDir, 'settings.json')));
    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    expect(written.statusLine.type).toBe('command');
  });

  it('defaults to ~/.claude when no config dir is given', () => {
    installHooksOnly();
    expect(n(String(mockWriteFileSync.mock.calls[0][0]))).toBe('/mock/home/.claude/settings.json');
  });

  it('skips a settings.json write when the generated content is unchanged', () => {
    // First install writes the file.
    installHooksOnly(profileDir);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

    // A repeat install (warm launch / repeat profile spawn) produces identical
    // content, so the second write is deduplicated away.
    installHooksOnly(profileDir);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

    // A different CLI version changes the generated hooks, so the next install
    // must write again.
    vi.mocked(getClaudeVersion).mockReturnValueOnce('1.0.38');
    installHooksOnly(profileDir);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
  });
});

/** The generated Python body for one event's capture script. */
function eventScriptBody(event: string): string {
  const scripts = new Map<string, string>(
    vi.mocked(installEventScript).mock.calls.map(([name, code]) => [name as string, code as string])
  );
  return scripts.get(`claude_event_${event}.py`) ?? '';
}

/** Every hook handler installed for one event, across all matcher entries. */
function hookHandlersFor(written: any, event: string): Array<{ command: string; timeout?: number }> {
  return (written.hooks[event] ?? []).flatMap((m: { hooks: Array<{ command: string; timeout?: number }> }) => m.hooks);
}

/** Just the commands for one event. */
function hookCommandsFor(written: any, event: string): string[] {
  return hookHandlersFor(written, event).map((h) => h.command);
}

describe('installHooks', () => {
  it('writes hooks to settings.json', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    expect(mockMkdirSync).toHaveBeenCalledWith(path.join('/mock/home', '.claude'), { recursive: true });
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
      if (n(String(filePath)) === '/mock/home/.claude/settings.json') {
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
      if (n(String(filePath)) === '/mock/home/.claude/settings.json') {
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

    const coreEvents = [
      'SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure',
      'Stop', 'StopFailure', 'PermissionRequest',
    ];
    for (const event of coreEvents) {
      expect(hookEvents).toContain(event);
    }

    const inspectorEvents = [
      'PreToolUse', 'PermissionDenied', 'SubagentStart', 'SubagentStop', 'Notification',
      'PreCompact', 'PostCompact', 'SessionEnd', 'TaskCreated', 'TaskCompleted',
      'WorktreeRemove', 'CwdChanged', 'FileChanged',
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

    // PostToolUse event cmd should include event capture
    const toolUseHooks = written.hooks.PostToolUse
      .flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks);
    expect(toolUseHooks.some((h: { command: string }) =>
      h.command.includes('.events')
    )).toBe(true);

    // Inspector-only hooks should have only event logger (no status writer)
    for (const event of inspectorEvents) {
      const matchers = written.hooks[event];
      const allHooks = matchers.flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks);
      expect(allHooks.some((h: { command: string }) => h.command.includes('.status'))).toBe(false);
      expect(allHooks.some((h: { command: string }) => h.command.includes('.events'))).toBe(true);
    }
  });

  // The main agent fires spurious top-level Stop hooks while waiting on parallel
  // subagents. When SubagentStart is supported we route Stop through the
  // subagent-aware writer instead of the naive echo-Stop:completed command.
  it('uses the subagent-aware Stop writer when SubagentStart is supported', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    const stopCommands = written.hooks.Stop
      .flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks)
      .map((h: { command: string }) => h.command);
    expect(stopCommands.some((c: string) => c.includes('stop_status_writer'))).toBe(true);
    expect(stopCommands.some((c: string) => c.includes('echo Stop:completed'))).toBe(false);
    // Still exactly the status writer + the inspector event capture hook.
    const vibeyardHookCount = stopCommands.filter((c: string) => c.includes('# vibeyard-hook')).length;
    expect(vibeyardHookCount).toBe(2);
  });

  it('falls back to the echo Stop writer when SubagentStart is unsupported', () => {
    // 2.0.42 supports Stop (min 1.0.38) but not SubagentStart (min 2.0.43).
    vi.mocked(getClaudeVersion).mockReturnValueOnce('2.0.42');
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    const stopCommands = written.hooks.Stop
      .flatMap((m: { hooks: Array<{ command: string }> }) => m.hooks)
      .map((h: { command: string }) => h.command);
    expect(stopCommands.some((c: string) => c.includes('echo Stop:completed'))).toBe(true);
    expect(stopCommands.some((c: string) => c.includes('stop_status_writer'))).toBe(false);
  });

  it('injects the in-flight subagent counter only into the relevant event scripts', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const bodyOf = eventScriptBody;

    // Counter mutations land in exactly the four counter-affecting scripts.
    // The counter is now a fallback — stop_status_writer.py prefers the Stop
    // payload's `background_tasks` — but it is consulted whenever that payload
    // reports nothing holding (empty *or* absent), so it must still be
    // maintained on every CLI version.
    expect(bodyOf('SubagentStart')).toContain('.subagents');
    expect(bodyOf('SubagentStart')).toContain('n=n+1');
    expect(bodyOf('SubagentStop')).toContain('n=max(0,n-1)');
    // SessionStart resets the counter but skips mid-turn auto-compaction.
    expect(bodyOf('SessionStart')).toContain('"n":0');
    expect(bodyOf('SessionStart')).toContain('!="compact"');
    // PostToolUse only refreshes the timestamp for subagent tool activity.
    expect(bodyOf('PostToolUse')).toContain('.subagents');
    expect(bodyOf('PostToolUse')).toContain('if d.get("agent_id")');
    expect(bodyOf('PostToolUse')).not.toContain('n=n+1');
    // Unrelated event scripts stay counter-free.
    expect(bodyOf('PreToolUse')).not.toContain('.subagents');
    expect(bodyOf('UserPromptSubmit')).not.toContain('.subagents');
  });

  it('wires tool-failure capture onto PostToolUseFailure and nowhere else', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    const commandsFor = (event: string) => hookCommandsFor(written, event);

    expect(commandsFor('PostToolUseFailure').some((c: string) => c.includes('.toolfailure'))).toBe(true);
    for (const event of Object.keys(written.hooks)) {
      if (event === 'PostToolUseFailure') continue;
      expect(commandsFor(event).some((c: string) => c.includes('.toolfailure'))).toBe(false);
    }
  });

  it('omits PostToolUseFailure on a CLI older than its minimum version', () => {
    // 2.1.118 supports PermissionDenied (2.1.89) but not PostToolUseFailure (2.1.119).
    vi.mocked(getClaudeVersion).mockReturnValueOnce('2.1.118');
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const hookEvents = Object.keys(JSON.parse(String(mockWriteFileSync.mock.calls[0][1])).hooks);
    expect(hookEvents).toContain('PermissionDenied');
    expect(hookEvents).not.toContain('PostToolUseFailure');
  });

  it('requests a longer timeout only for SessionEnd, whose default budget is 1.5s', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    const timeoutsFor = (event: string) => hookHandlersFor(written, event).map((h) => h.timeout);

    expect(timeoutsFor('SessionEnd')).toEqual([5]);
    for (const event of Object.keys(written.hooks)) {
      if (event === 'SessionEnd') continue;
      expect(timeoutsFor(event).every((t: number | undefined) => t === undefined)).toBe(true);
    }
  });

  it('captures only real hook-payload fields into inspector events', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const body = eventScriptBody('Notification');

    // Real per-event fields the timeline renders.
    for (const field of ['notification_type', 'new_cwd', 'teammate_name', 'task_subject', 'action']) {
      expect(body).toContain(`"${field}"`);
    }
    // Captured fields are limited to what something actually reads — there is no
    // generic payload viewer, so an unread field is written, parsed, IPC'd and
    // typed for nothing.
    for (const field of ['load_reason', 'memory_type', 'elicitation_id', 'tool_use_id']) {
      expect(body).not.toContain(`"${field}"`);
    }
    // None of these is a top-level hook-payload field, so the code reading them
    // was dead. `type`/`username` are especially easy to re-add by mistake: they
    // appear in the docs' Elicitation example, but nested inside
    // requested_schema.properties.username.type.
    for (const field of ['config_key', 'question', 'answer', 'username']) {
      expect(body).not.toContain(`"${field}"`);
    }
    expect(body).not.toContain('elicitation_type');
    // Long strings are truncated before hitting the .events log.
    expect(body).toContain('len(v)>2000');
  });

  // PostToolUse now fires only on SUCCESS, so treating any non-empty
  // tool_response as a failure produced a .toolfailure file for every
  // successful tool call. The only PostToolUse-derived signal left is a Read
  // truncated by the token cap, which is a success, not a failure.
  it('derives a .toolfailure from PostToolUse only for a token-capped Read', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const body = eventScriptBody('PostToolUse');

    expect(body).toContain('truncatedByTokenCap');
    expect(body).toContain('tn=="Read"');
    // No blanket "any tool_response is an error" synthesis.
    expect(body).not.toContain('tool_result');
    expect(body).not.toContain('fe=tr');
  });

  // CC >= 2.1.50 treats WorktreeCreate as a path-replacement hook that must
  // create the worktree itself and print the path. Installing an observer hook
  // breaks worktree creation. See issue #110.
  it('does not install a WorktreeCreate hook', () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    installHooks();

    const written = JSON.parse(String(mockWriteFileSync.mock.calls[0][1]));
    expect(Object.keys(written.hooks)).not.toContain('WorktreeCreate');

    const installed = vi.mocked(installEventScript).mock.calls.map(([name]) => name);
    expect(installed).not.toContain('claude_event_WorktreeCreate.py');
  });
});
