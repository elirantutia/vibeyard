import { vi } from 'vitest';
import * as path from 'path';
import { isWin } from '../platform';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  statSync: vi.fn(() => { throw new Error('ENOENT'); }),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../pty-manager', () => ({
  getFullPath: vi.fn(() => isWin ? '/usr/local/bin;/usr/bin' : '/usr/local/bin:/usr/bin'),
}));

vi.mock('../opencode-config', () => ({
  getOpenCodeConfig: vi.fn(async () => ({ mcpServers: [], agents: [], skills: [], commands: [] })),
}));

vi.mock('../config-watcher', () => ({
  startConfigWatcher: vi.fn(),
  stopConfigWatcher: vi.fn(),
}));

vi.mock('../opencode-hooks', () => ({
  installOpenCodeHooks: vi.fn(),
  validateOpenCodeHooks: vi.fn(() => ({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} })),
  cleanupOpenCodeHooks: vi.fn(),
  SESSION_ID_VAR: 'VIBEYARD_SESSION_ID',
}));

import * as fs from 'fs';
import { execSync } from 'child_process';
import { OpenCodeProvider, _resetCachedPath } from './opencode-provider';
import { getOpenCodeConfig } from '../opencode-config';
import { startConfigWatcher, stopConfigWatcher } from '../config-watcher';
import { installOpenCodeHooks, validateOpenCodeHooks, cleanupOpenCodeHooks } from '../opencode-hooks';

const mockStatSync = vi.mocked(fs.statSync);
const mockExecSync = vi.mocked(execSync);
const fileStat = { isFile: () => true } as fs.Stats;
const mockGetOpenCodeConfig = vi.mocked(getOpenCodeConfig);
const mockStartConfigWatcher = vi.mocked(startConfigWatcher);
const mockStopConfigWatcher = vi.mocked(stopConfigWatcher);
const mockInstallOpenCodeHooks = vi.mocked(installOpenCodeHooks);
const mockValidateOpenCodeHooks = vi.mocked(validateOpenCodeHooks);
const mockCleanupOpenCodeHooks = vi.mocked(cleanupOpenCodeHooks);

let provider: OpenCodeProvider;

beforeEach(() => {
  vi.clearAllMocks();
  mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
  _resetCachedPath();
  provider = new OpenCodeProvider();
});

describe('meta', () => {
  it('has correct id, displayName, and binaryName', () => {
    expect(provider.meta.id).toBe('opencode');
    expect(provider.meta.displayName).toBe('OpenCode');
    expect(provider.meta.binaryName).toBe('opencode');
  });

  it('has sessionResume disabled and hookStatus capabilities enabled', () => {
    const caps = provider.meta.capabilities;
    expect(caps.sessionResume).toBe(false);
    expect(caps.costTracking).toBe(false);
    expect(caps.contextWindow).toBe(false);
    expect(caps.hookStatus).toBe(true);
    expect(caps.configReading).toBe(true);
    expect(caps.shiftEnterNewline).toBe(false);
    expect(caps.pendingPromptTrigger).toBe('startup-arg');
    expect(caps.planModeArg).toBe('--agent plan');
  });

  it('has defaultContextWindowSize of 200,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(200_000);
  });
});

describe('resolveBinaryPath', () => {
  const firstCandidate = isWin
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'opencode.cmd')
    : '/usr/local/bin/opencode';

  it('returns candidate path when statSync finds a file', () => {
    mockStatSync.mockImplementation((p) => {
      if (p === firstCandidate) return fileStat;
      throw new Error('ENOENT');
    });
    expect(provider.resolveBinaryPath()).toBe(firstCandidate);
  });

  it(`falls back to ${isWin ? 'where' : 'which'} opencode when no candidate exists`, () => {
    mockExecSync.mockReturnValue('/some/other/path/opencode\n' as any);
    expect(provider.resolveBinaryPath()).toBe('/some/other/path/opencode');
  });

  it('falls back to bare "opencode" when both candidate and which fail', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(provider.resolveBinaryPath()).toBe('opencode');
  });

  it('caches result on subsequent calls', () => {
    mockStatSync.mockImplementation((p) => {
      if (p === firstCandidate) return fileStat;
      throw new Error('ENOENT');
    });
    provider.resolveBinaryPath();
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(provider.resolveBinaryPath()).toBe(firstCandidate);
  });
});

describe('validatePrerequisites', () => {
  const validateCandidate = isWin
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'opencode.cmd')
    : '/opt/homebrew/bin/opencode';

  it('returns ok when binary found via statSync', () => {
    mockStatSync.mockImplementation((p) => {
      if (p === validateCandidate) return fileStat;
      throw new Error('ENOENT');
    });
    expect(provider.validatePrerequisites()).toBe(true);
  });

  it('returns ok when binary found via which', () => {
    mockExecSync.mockReturnValue('/resolved/opencode\n' as any);
    expect(provider.validatePrerequisites()).toBe(true);
  });

  it('returns not ok when binary not found anywhere', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(provider.validatePrerequisites()).toBe(false);
  });
});

describe('buildEnv', () => {
  it('sets PATH to the augmented PATH', () => {
    const env = provider.buildEnv('sess-123', {});
    expect(env.PATH).toBe(isWin ? '/usr/local/bin;/usr/bin' : '/usr/local/bin:/usr/bin');
  });

  it('sets VIBEYARD_SESSION_ID to the session ID', () => {
    const env = provider.buildEnv('sess-123', {});
    expect(env.VIBEYARD_SESSION_ID).toBe('sess-123');
  });

  it('sets OPENCODE_CLIENT to vibeyard', () => {
    const env = provider.buildEnv('sess-123', {});
    expect(env.OPENCODE_CLIENT).toBe('vibeyard');
  });

  it('preserves existing env vars', () => {
    const env = provider.buildEnv('sess-123', { MY_KEY: '/custom', OTHER: 'val' });
    expect(env.MY_KEY).toBe('/custom');
    expect(env.OTHER).toBe('val');
  });
});

describe('buildArgs', () => {
  it('returns ["--session", id] when isResume=true with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '' });
    expect(args).toEqual(['--session', 'sid-1']);
  });

  it('returns [] when isResume=false with no initialPrompt', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('returns [] when cliSessionId is null and no initialPrompt', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('passes initialPrompt via --prompt when not resuming', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: 'fix the bug' });
    expect(args).toEqual(['--prompt', 'fix the bug']);
  });

  it('does not pass initialPrompt when resuming', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '', initialPrompt: 'fix the bug' });
    expect(args).toEqual(['--session', 'sid-1']);
  });

  it('splits extraArgs on whitespace and appends', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--model anthropic/claude-sonnet-4-5  --log-level DEBUG' });
    expect(args).toEqual(['--model', 'anthropic/claude-sonnet-4-5', '--log-level', 'DEBUG']);
  });

  it('combines resume args and extra args', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '--model anthropic/claude-opus-4-5' });
    expect(args).toEqual(['--session', 'sid-1', '--model', 'anthropic/claude-opus-4-5']);
  });
});

describe('getShiftEnterSequence', () => {
  it('returns null', () => {
    expect(provider.getShiftEnterSequence()).toBeNull();
  });
});

describe('hooks integration', () => {
  it('installHooks delegates to installOpenCodeHooks with projectPath', async () => {
    await provider.installHooks(null, '/project');
    expect(mockInstallOpenCodeHooks).toHaveBeenCalledWith('/project');
  });

  it('validateSettings delegates to validateOpenCodeHooks', () => {
    const result = provider.validateSettings('/project');
    expect(mockValidateOpenCodeHooks).toHaveBeenCalledWith('/project');
    expect(result).toEqual({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} });
  });

  it('cleanup calls cleanupOpenCodeHooks and stopConfigWatcher', () => {
    provider.cleanup();
    expect(mockStopConfigWatcher).toHaveBeenCalled();
    expect(mockCleanupOpenCodeHooks).toHaveBeenCalled();
  });

  it('reinstallSettings delegates to installOpenCodeHooks without args', () => {
    provider.reinstallSettings();
    expect(mockInstallOpenCodeHooks).toHaveBeenCalledWith();
  });
});

describe('other methods', () => {
  it('getConfig delegates to opencode config reader', async () => {
    const config = {
      mcpServers: [{ name: 'myserver', url: 'npx @my/server', status: 'configured', scope: 'user' as const, filePath: '/x' }],
      agents: [],
      skills: [],
      commands: [],
    };
    mockGetOpenCodeConfig.mockResolvedValueOnce(config);
    await expect(provider.getConfig('/some/path')).resolves.toEqual(config);
    expect(mockGetOpenCodeConfig).toHaveBeenCalledWith('/some/path');
  });

  it('installStatusScripts does not throw', () => {
    expect(() => provider.installStatusScripts()).not.toThrow();
  });

  it('starts an opencode config watcher', () => {
    const win = { id: 1 } as any;
    provider.startConfigWatcher(win, '/project');
    expect(mockStartConfigWatcher).toHaveBeenCalledWith(win, '/project', 'opencode');
  });

  it('stopConfigWatcher delegates to stopConfigWatcher', () => {
    provider.stopConfigWatcher();
    expect(mockStopConfigWatcher).toHaveBeenCalled();
  });
});
