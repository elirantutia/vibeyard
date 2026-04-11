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

vi.mock('../copilot-config', () => ({
  getCopilotConfig: vi.fn(async () => ({ mcpServers: [], agents: [], skills: [], commands: [] })),
}));

vi.mock('../config-watcher', () => ({
  startConfigWatcher: vi.fn(),
  stopConfigWatcher: vi.fn(),
}));

vi.mock('../copilot-hooks', () => ({
  installCopilotHooks: vi.fn(),
  validateCopilotHooks: vi.fn(() => ({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} })),
  cleanupCopilotHooks: vi.fn(),
  SESSION_ID_VAR: 'VIBEYARD_SESSION_ID',
}));

import * as fs from 'fs';
import { execSync } from 'child_process';
import { CopilotProvider, _resetCachedPath } from './copilot-provider';
import { getCopilotConfig } from '../copilot-config';
import { startConfigWatcher, stopConfigWatcher } from '../config-watcher';
import { installCopilotHooks, validateCopilotHooks, cleanupCopilotHooks } from '../copilot-hooks';

const mockStatSync = vi.mocked(fs.statSync);
const mockExistsSync = vi.mocked(fs.existsSync);
const mockExecSync = vi.mocked(execSync);
const fileStat = { isFile: () => true } as fs.Stats;
const mockGetCopilotConfig = vi.mocked(getCopilotConfig);
const mockStartConfigWatcher = vi.mocked(startConfigWatcher);
const mockStopConfigWatcher = vi.mocked(stopConfigWatcher);
const mockInstallCopilotHooks = vi.mocked(installCopilotHooks);
const mockValidateCopilotHooks = vi.mocked(validateCopilotHooks);
const mockCleanupCopilotHooks = vi.mocked(cleanupCopilotHooks);

let provider: CopilotProvider;

beforeEach(() => {
  vi.clearAllMocks();
  mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
  _resetCachedPath();
  provider = new CopilotProvider();
});

describe('meta', () => {
  it('has correct id, displayName, and binaryName', () => {
    expect(provider.meta.id).toBe('copilot');
    expect(provider.meta.displayName).toBe('GitHub Copilot');
    expect(provider.meta.binaryName).toBe('copilot');
  });

  it('has sessionResume and hookStatus capabilities enabled', () => {
    const caps = provider.meta.capabilities;
    expect(caps.sessionResume).toBe(true);
    expect(caps.costTracking).toBe(false);
    expect(caps.contextWindow).toBe(false);
    expect(caps.hookStatus).toBe(true);
    expect(caps.configReading).toBe(true);
    expect(caps.shiftEnterNewline).toBe(false);
    expect(caps.pendingPromptTrigger).toBe('startup-arg');
    expect(caps.planModeArg).toBe('--mode plan');
  });

  it('has defaultContextWindowSize of 128,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(128_000);
  });
});

describe('resolveBinaryPath', () => {
  const firstCandidate = isWin
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'copilot.cmd')
    : '/usr/local/bin/copilot';

  it('returns candidate path when statSync finds a file', () => {
    mockStatSync.mockImplementation((p) => {
      if (p === firstCandidate) return fileStat;
      throw new Error('ENOENT');
    });
    expect(provider.resolveBinaryPath()).toBe(firstCandidate);
  });

  it(`falls back to ${isWin ? 'where' : 'which'} copilot when no candidate exists`, () => {
    mockExecSync.mockReturnValue('/some/other/path/copilot\n' as any);
    expect(provider.resolveBinaryPath()).toBe('/some/other/path/copilot');
  });

  it('falls back to bare "copilot" when both candidate and which fail', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(provider.resolveBinaryPath()).toBe('copilot');
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
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'copilot.cmd')
    : '/opt/homebrew/bin/copilot';

  it('returns true when binary found via statSync', () => {
    mockStatSync.mockImplementation((p) => {
      if (p === validateCandidate) return fileStat;
      throw new Error('ENOENT');
    });
    expect(provider.validatePrerequisites()).toBe(true);
  });

  it('returns true when binary found via which', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/resolved/copilot\n' as any);
    expect(provider.validatePrerequisites()).toBe(true);
  });

  it('returns false when binary not found anywhere', () => {
    mockExistsSync.mockReturnValue(false);
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

  it('preserves existing env vars', () => {
    const env = provider.buildEnv('sess-123', { SOME_VAR: '/custom', OTHER: 'val' });
    expect(env.SOME_VAR).toBe('/custom');
    expect(env.OTHER).toBe('val');
  });
});

describe('buildArgs', () => {
  it('returns ["--resume=<id>"] when isResume=true with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '' });
    expect(args).toEqual(['--resume=sid-1']);
  });

  it('returns [] when isResume=false with cliSessionId (no continue-in-place)', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('returns [] when cliSessionId is null', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('passes initialPrompt as -i arg when not resuming', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: 'fix the bug' });
    expect(args).toEqual(['-i', 'fix the bug']);
  });

  it('does not pass initialPrompt when resuming', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '', initialPrompt: 'fix the bug' });
    expect(args).toEqual(['--resume=sid-1']);
  });

  it('splits extraArgs on whitespace and appends', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--model gpt-5.2  --autopilot' });
    expect(args).toEqual(['--model', 'gpt-5.2', '--autopilot']);
  });

  it('combines resume args and extra args', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '--model gpt-5.2' });
    expect(args).toEqual(['--resume=sid-1', '--model', 'gpt-5.2']);
  });
});

describe('getShiftEnterSequence', () => {
  it('returns null', () => {
    expect(provider.getShiftEnterSequence()).toBeNull();
  });
});

describe('hooks integration', () => {
  it('installHooks delegates to installCopilotHooks', async () => {
    await provider.installHooks();
    expect(mockInstallCopilotHooks).toHaveBeenCalled();
  });

  it('validateSettings delegates to validateCopilotHooks', () => {
    const result = provider.validateSettings();
    expect(mockValidateCopilotHooks).toHaveBeenCalled();
    expect(result).toEqual({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} });
  });

  it('cleanup calls cleanupCopilotHooks and stopConfigWatcher', () => {
    provider.cleanup();
    expect(mockStopConfigWatcher).toHaveBeenCalled();
    expect(mockCleanupCopilotHooks).toHaveBeenCalled();
  });

  it('reinstallSettings delegates to installCopilotHooks', () => {
    provider.reinstallSettings();
    expect(mockInstallCopilotHooks).toHaveBeenCalled();
  });
});

describe('other methods', () => {
  it('getConfig delegates to copilot config reader', async () => {
    const config = { mcpServers: [{ name: 'a', url: 'b', status: 'configured', scope: 'user', filePath: '/x' }], agents: [], skills: [], commands: [] };
    mockGetCopilotConfig.mockResolvedValueOnce(config);
    await expect(provider.getConfig('/some/path')).resolves.toEqual(config);
    expect(mockGetCopilotConfig).toHaveBeenCalledWith('/some/path');
  });

  it('installStatusScripts does not throw', () => {
    expect(() => provider.installStatusScripts()).not.toThrow();
  });

  it('starts a copilot config watcher', () => {
    const win = { id: 1 } as any;
    provider.startConfigWatcher(win, '/project');
    expect(mockStartConfigWatcher).toHaveBeenCalledWith(win, '/project', 'copilot');
  });
});
