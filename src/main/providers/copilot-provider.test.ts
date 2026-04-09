import { vi } from 'vitest';
import * as path from 'path';

const isWin = process.platform === 'win32';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
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

const mockExistsSync = vi.mocked(fs.existsSync);
const mockExecSync = vi.mocked(execSync);
const mockGetCopilotConfig = vi.mocked(getCopilotConfig);
const mockStartConfigWatcher = vi.mocked(startConfigWatcher);
const mockStopConfigWatcher = vi.mocked(stopConfigWatcher);
const mockInstallCopilotHooks = vi.mocked(installCopilotHooks);
const mockValidateCopilotHooks = vi.mocked(validateCopilotHooks);
const mockCleanupCopilotHooks = vi.mocked(cleanupCopilotHooks);

let provider: CopilotProvider;

beforeEach(() => {
  vi.clearAllMocks();
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
  });

  it('has defaultContextWindowSize of 128,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(128_000);
  });
});

describe('resolveBinaryPath', () => {
  const firstCandidate = isWin
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'copilot.cmd')
    : '/usr/local/bin/copilot';

  it('returns candidate path when existsSync returns true', () => {
    mockExistsSync.mockImplementation((p) => p === firstCandidate);
    expect(provider.resolveBinaryPath()).toBe(firstCandidate);
  });

  it(`falls back to ${isWin ? 'where' : 'which'} copilot when no candidate exists`, () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/some/other/path/copilot\n' as any);
    expect(provider.resolveBinaryPath()).toBe('/some/other/path/copilot');
  });

  it('falls back to bare "copilot" when both candidate and which fail', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(provider.resolveBinaryPath()).toBe('copilot');
  });

  it('caches result on subsequent calls', () => {
    mockExistsSync.mockImplementation((p) => p === firstCandidate);
    provider.resolveBinaryPath();
    mockExistsSync.mockReturnValue(false);
    expect(provider.resolveBinaryPath()).toBe(firstCandidate);
  });
});

describe('validatePrerequisites', () => {
  const validateCandidate = isWin
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'copilot.cmd')
    : '/opt/homebrew/bin/copilot';

  it('returns ok when binary found via existsSync', () => {
    mockExistsSync.mockImplementation((p) => p === validateCandidate);
    expect(provider.validatePrerequisites()).toEqual({ ok: true, message: '' });
  });

  it('returns ok when binary found via which', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/resolved/copilot\n' as any);
    expect(provider.validatePrerequisites()).toEqual({ ok: true, message: '' });
  });

  it('returns not ok when binary not found anywhere', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    const result = provider.validatePrerequisites();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('GitHub Copilot CLI not found');
    expect(result.message).toContain('gh extension install github/gh-copilot');
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
    const env = provider.buildEnv('sess-123', { GITHUB_TOKEN: 'tok123', OTHER: 'val' });
    expect(env.GITHUB_TOKEN).toBe('tok123');
    expect(env.OTHER).toBe('val');
  });
});

describe('buildArgs', () => {
  it('returns ["--resume=<id>"] when isResume=true with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '' });
    expect(args).toEqual(['--resume=sid-1']);
  });

  it('returns [] when isResume=false with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('returns [] when cliSessionId is null', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('appends -i flag when initialPrompt is provided', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: 'Fix the bug' });
    expect(args).toEqual(['-i', 'Fix the bug']);
  });

  it('does not append -i flag when initialPrompt is absent', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('splits extraArgs on whitespace and appends', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--model gpt-4o  --debug' });
    expect(args).toEqual(['--model', 'gpt-4o', '--debug']);
  });

  it('combines resume args and extra args', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '--model gpt-4o' });
    expect(args).toEqual(['--resume=sid-1', '--model', 'gpt-4o']);
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
    const config = { mcpServers: [{ name: 'a', url: 'b', status: 'configured', scope: 'user' as const, filePath: '/x' }], agents: [], skills: [], commands: [] };
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
