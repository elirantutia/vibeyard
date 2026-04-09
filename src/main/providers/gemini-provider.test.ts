import { vi } from 'vitest';
import * as path from 'path';
import { isWin } from '../platform';

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

vi.mock('../gemini-config', () => ({
  getGeminiConfig: vi.fn(async () => ({ mcpServers: [], agents: [], skills: [], commands: [] })),
}));

vi.mock('../config-watcher', () => ({
  startConfigWatcher: vi.fn(),
  stopConfigWatcher: vi.fn(),
}));

vi.mock('../gemini-hooks', () => ({
  installGeminiHooks: vi.fn(),
  validateGeminiHooks: vi.fn(() => ({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} })),
  cleanupGeminiHooks: vi.fn(),
  SESSION_ID_VAR: 'VIBEYARD_SESSION_ID',
}));

import * as fs from 'fs';
import { execSync } from 'child_process';
import { GeminiProvider, _resetCachedPath } from './gemini-provider';
import { getGeminiConfig } from '../gemini-config';
import { startConfigWatcher, stopConfigWatcher } from '../config-watcher';
import { installGeminiHooks, validateGeminiHooks, cleanupGeminiHooks } from '../gemini-hooks';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockExecSync = vi.mocked(execSync);
const mockGetGeminiConfig = vi.mocked(getGeminiConfig);
const mockStartConfigWatcher = vi.mocked(startConfigWatcher);
const mockStopConfigWatcher = vi.mocked(stopConfigWatcher);
const mockInstallGeminiHooks = vi.mocked(installGeminiHooks);
const mockValidateGeminiHooks = vi.mocked(validateGeminiHooks);
const mockCleanupGeminiHooks = vi.mocked(cleanupGeminiHooks);

let provider: GeminiProvider;

beforeEach(() => {
  vi.clearAllMocks();
  _resetCachedPath();
  provider = new GeminiProvider();
});

describe('meta', () => {
  it('has correct id, displayName, and binaryName', () => {
    expect(provider.meta.id).toBe('gemini');
    expect(provider.meta.displayName).toBe('Gemini CLI');
    expect(provider.meta.binaryName).toBe('gemini');
  });

  it('has sessionResume, hookStatus, and configReading capabilities enabled', () => {
    const caps = provider.meta.capabilities;
    expect(caps.sessionResume).toBe(true);
    expect(caps.costTracking).toBe(false);
    expect(caps.contextWindow).toBe(false);
    expect(caps.hookStatus).toBe(true);
    expect(caps.configReading).toBe(true);
    expect(caps.shiftEnterNewline).toBe(false);
    expect(caps.pendingPromptTrigger).toBe('startup-arg');
    expect(caps.planModeArg).toBe('--approval-mode=plan');
  });

  it('has defaultContextWindowSize of 1,000,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(1_000_000);
  });
});

describe('resolveBinaryPath', () => {
  const firstCandidate = isWin
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'gemini.cmd')
    : '/usr/local/bin/gemini';

  it('returns candidate path when existsSync returns true', () => {
    mockExistsSync.mockImplementation((p) => p === firstCandidate);
    expect(provider.resolveBinaryPath()).toBe(firstCandidate);
  });

  it(`falls back to ${isWin ? 'where' : 'which'} gemini when no candidate exists`, () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/some/other/path/gemini\n' as any);
    expect(provider.resolveBinaryPath()).toBe('/some/other/path/gemini');
  });

  it('falls back to bare "gemini" when both candidate and which fail', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(provider.resolveBinaryPath()).toBe('gemini');
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
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'gemini.cmd')
    : '/opt/homebrew/bin/gemini';

  it('returns ok when binary found via existsSync', () => {
    mockExistsSync.mockImplementation((p) => p === validateCandidate);
    expect(provider.validatePrerequisites()).toEqual({ ok: true, message: '' });
  });

  it('returns ok when binary found via which', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/resolved/gemini\n' as any);
    expect(provider.validatePrerequisites()).toEqual({ ok: true, message: '' });
  });

  it('returns not ok when binary not found anywhere', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    const result = provider.validatePrerequisites();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Gemini CLI not found');
    expect(result.message).toContain('@google/gemini-cli');
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
    const env = provider.buildEnv('sess-123', { GEMINI_API_KEY: 'key123', OTHER: 'val' });
    expect(env.GEMINI_API_KEY).toBe('key123');
    expect(env.OTHER).toBe('val');
  });
});

describe('buildArgs', () => {
  it('returns ["-r", id] when isResume=true with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '' });
    expect(args).toEqual(['-r', 'sid-1']);
  });

  it('returns [] when isResume=false with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('returns [] when cliSessionId is null', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('splits extraArgs on whitespace and appends', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--model gemini-2.5-flash  --sandbox' });
    expect(args).toEqual(['--model', 'gemini-2.5-flash', '--sandbox']);
  });

  it('combines resume args and extra args', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '--model gemini-2.5-flash' });
    expect(args).toEqual(['-r', 'sid-1', '--model', 'gemini-2.5-flash']);
  });

  it('appends -i flag when initialPrompt is provided', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: 'Fix the hooks config' });
    expect(args).toEqual(['-i', 'Fix the hooks config']);
  });

  it('does not append -i flag when initialPrompt is absent', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });
});

describe('getShiftEnterSequence', () => {
  it('returns null', () => {
    expect(provider.getShiftEnterSequence()).toBeNull();
  });
});

describe('hooks integration', () => {
  it('installHooks delegates to installGeminiHooks', async () => {
    await provider.installHooks();
    expect(mockInstallGeminiHooks).toHaveBeenCalled();
  });

  it('validateSettings delegates to validateGeminiHooks', () => {
    const result = provider.validateSettings();
    expect(mockValidateGeminiHooks).toHaveBeenCalled();
    expect(result).toEqual({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} });
  });

  it('cleanup calls cleanupGeminiHooks and stopConfigWatcher', () => {
    provider.cleanup();
    expect(mockStopConfigWatcher).toHaveBeenCalled();
    expect(mockCleanupGeminiHooks).toHaveBeenCalled();
  });

  it('reinstallSettings delegates to installGeminiHooks', () => {
    provider.reinstallSettings();
    expect(mockInstallGeminiHooks).toHaveBeenCalled();
  });
});

describe('other methods', () => {
  it('getConfig delegates to gemini config reader', async () => {
    const config = { mcpServers: [{ name: 'a', url: 'b', status: 'configured', scope: 'user' as const, filePath: '/x' }], agents: [], skills: [], commands: [] };
    mockGetGeminiConfig.mockResolvedValueOnce(config);
    await expect(provider.getConfig('/some/path')).resolves.toEqual(config);
    expect(mockGetGeminiConfig).toHaveBeenCalledWith('/some/path');
  });

  it('installStatusScripts does not throw', () => {
    expect(() => provider.installStatusScripts()).not.toThrow();
  });

  it('starts a gemini config watcher', () => {
    const win = { id: 1 } as any;
    provider.startConfigWatcher(win, '/project');
    expect(mockStartConfigWatcher).toHaveBeenCalledWith(win, '/project', 'gemini');
  });
});
