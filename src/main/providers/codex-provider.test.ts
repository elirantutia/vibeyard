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

vi.mock('../codex-config', () => ({
  getCodexConfig: vi.fn(async () => ({ mcpServers: [], agents: [], skills: [], commands: [] })),
}));

vi.mock('../config-watcher', () => ({
  startConfigWatcher: vi.fn(),
  stopConfigWatcher: vi.fn(),
}));

vi.mock('../codex-hooks', () => ({
  installCodexHooks: vi.fn(),
  validateCodexHooks: vi.fn(() => ({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} })),
  cleanupCodexHooks: vi.fn(),
  SESSION_ID_VAR: 'VIBEYARD_SESSION_ID',
}));

import * as fs from 'fs';
import { execSync } from 'child_process';
import { CodexProvider, _resetCachedPath } from './codex-provider';
import { getCodexConfig } from '../codex-config';
import { startConfigWatcher, stopConfigWatcher } from '../config-watcher';
import { installCodexHooks, validateCodexHooks, cleanupCodexHooks } from '../codex-hooks';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockExecSync = vi.mocked(execSync);
const mockGetCodexConfig = vi.mocked(getCodexConfig);
const mockStartConfigWatcher = vi.mocked(startConfigWatcher);
const mockStopConfigWatcher = vi.mocked(stopConfigWatcher);
const mockInstallCodexHooks = vi.mocked(installCodexHooks);
const mockValidateCodexHooks = vi.mocked(validateCodexHooks);
const mockCleanupCodexHooks = vi.mocked(cleanupCodexHooks);

let provider: CodexProvider;

beforeEach(() => {
  vi.clearAllMocks();
  _resetCachedPath();
  provider = new CodexProvider();
});

describe('meta', () => {
  it('has correct id, displayName, and binaryName', () => {
    expect(provider.meta.id).toBe('codex');
    expect(provider.meta.displayName).toBe('Codex CLI');
    expect(provider.meta.binaryName).toBe('codex');
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

  it('has defaultContextWindowSize of 200,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(200_000);
  });
});

describe('resolveBinaryPath', () => {
  const firstCandidate = isWin
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'codex.cmd')
    : '/usr/local/bin/codex';

  it('returns candidate path when existsSync returns true', () => {
    mockExistsSync.mockImplementation((p) => p === firstCandidate);
    expect(provider.resolveBinaryPath()).toBe(firstCandidate);
  });

  it(`falls back to ${isWin ? 'where' : 'which'} codex when no candidate exists`, () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/some/other/path/codex\n' as any);
    expect(provider.resolveBinaryPath()).toBe('/some/other/path/codex');
  });

  it('falls back to bare "codex" when both candidate and which fail', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(provider.resolveBinaryPath()).toBe('codex');
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
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'codex.cmd')
    : '/opt/homebrew/bin/codex';

  it('returns ok when binary found via existsSync', () => {
    mockExistsSync.mockImplementation((p) => p === validateCandidate);
    expect(provider.validatePrerequisites()).toEqual({ ok: true, message: '' });
  });

  it('returns ok when binary found via which', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/resolved/codex\n' as any);
    expect(provider.validatePrerequisites()).toEqual({ ok: true, message: '' });
  });

  it('returns not ok when binary not found anywhere', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    const result = provider.validatePrerequisites();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Codex CLI not found');
    expect(result.message).toContain('@openai/codex');
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
    const env = provider.buildEnv('sess-123', { CODEX_HOME: '/custom', OTHER: 'val' });
    expect(env.CODEX_HOME).toBe('/custom');
    expect(env.OTHER).toBe('val');
  });
});

describe('buildArgs', () => {
  it('returns ["resume", id] when isResume=true with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '' });
    expect(args).toEqual(['resume', 'sid-1']);
  });

  it('returns [] when isResume=false with cliSessionId (no continue-in-place)', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('returns [] when cliSessionId is null', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('passes initialPrompt as positional arg when not resuming', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: 'fix the bug' });
    expect(args).toEqual(['fix the bug']);
  });

  it('does not pass initialPrompt when resuming', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '', initialPrompt: 'fix the bug' });
    expect(args).toEqual(['resume', 'sid-1']);
  });

  it('splits extraArgs on whitespace and appends', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--model gpt-4o  --full-auto' });
    expect(args).toEqual(['--model', 'gpt-4o', '--full-auto']);
  });

  it('combines resume args and extra args', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '--model gpt-4o' });
    expect(args).toEqual(['resume', 'sid-1', '--model', 'gpt-4o']);
  });
});

describe('getShiftEnterSequence', () => {
  it('returns null (Codex uses Ctrl+J instead)', () => {
    expect(provider.getShiftEnterSequence()).toBeNull();
  });
});

describe('hooks integration', () => {
  it('installHooks delegates to installCodexHooks', async () => {
    await provider.installHooks();
    expect(mockInstallCodexHooks).toHaveBeenCalled();
  });

  it('validateSettings delegates to validateCodexHooks', () => {
    const result = provider.validateSettings();
    expect(mockValidateCodexHooks).toHaveBeenCalled();
    expect(result).toEqual({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} });
  });

  it('cleanup calls cleanupCodexHooks and stopConfigWatcher', () => {
    provider.cleanup();
    expect(mockStopConfigWatcher).toHaveBeenCalled();
    expect(mockCleanupCodexHooks).toHaveBeenCalled();
  });

  it('reinstallSettings delegates to installCodexHooks', () => {
    provider.reinstallSettings();
    expect(mockInstallCodexHooks).toHaveBeenCalled();
  });
});

describe('other methods', () => {
  it('getConfig delegates to codex config reader', async () => {
    const config = { mcpServers: [{ name: 'a', url: 'b', status: 'configured', scope: 'user', filePath: '/x' }], agents: [], skills: [], commands: [] };
    mockGetCodexConfig.mockResolvedValueOnce(config);
    await expect(provider.getConfig('/some/path')).resolves.toEqual(config);
    expect(mockGetCodexConfig).toHaveBeenCalledWith('/some/path');
  });

  it('installStatusScripts does not throw', () => {
    expect(() => provider.installStatusScripts()).not.toThrow();
  });

  it('starts a codex config watcher', () => {
    const win = { id: 1 } as any;
    provider.startConfigWatcher(win, '/project');
    expect(mockStartConfigWatcher).toHaveBeenCalledWith(win, '/project', 'codex');
  });
});
