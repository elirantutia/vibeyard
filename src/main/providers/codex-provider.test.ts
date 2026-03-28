import { vi } from 'vitest';

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
  getFullPath: vi.fn(() => '/usr/local/bin:/usr/bin'),
}));

import * as fs from 'fs';
import { execSync } from 'child_process';
import { CodexProvider, _resetCachedPath } from './codex-provider';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockExecSync = vi.mocked(execSync);

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

  it('has only sessionResume capability enabled', () => {
    const caps = provider.meta.capabilities;
    expect(caps.sessionResume).toBe(true);
    expect(caps.costTracking).toBe(false);
    expect(caps.contextWindow).toBe(false);
    expect(caps.hookStatus).toBe(false);
    expect(caps.configReading).toBe(false);
    expect(caps.shiftEnterNewline).toBe(false);
  });

  it('has defaultContextWindowSize of 200,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(200_000);
  });
});

describe('resolveBinaryPath', () => {
  it('returns candidate path when existsSync returns true', () => {
    mockExistsSync.mockImplementation((p) => p === '/usr/local/bin/codex');
    expect(provider.resolveBinaryPath()).toBe('/usr/local/bin/codex');
  });

  it('falls back to which codex when no candidate exists', () => {
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
    mockExistsSync.mockImplementation((p) => p === '/usr/local/bin/codex');
    provider.resolveBinaryPath();
    mockExistsSync.mockReturnValue(false);
    expect(provider.resolveBinaryPath()).toBe('/usr/local/bin/codex');
  });
});

describe('validatePrerequisites', () => {
  it('returns ok when binary found via existsSync', () => {
    mockExistsSync.mockImplementation((p) => p === '/opt/homebrew/bin/codex');
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
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
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

describe('stubs', () => {
  it('getConfig returns null', async () => {
    expect(await provider.getConfig('/some/path')).toBeNull();
  });

  it('validateSettings returns all-ok', () => {
    expect(provider.validateSettings()).toEqual({
      statusLine: 'vibeyard',
      hooks: 'complete',
      hookDetails: {},
    });
  });

  it('installHooks resolves without error', async () => {
    await expect(provider.installHooks()).resolves.toBeUndefined();
  });

  it('cleanup does not throw', () => {
    expect(() => provider.cleanup()).not.toThrow();
  });

  it('reinstallSettings does not throw', () => {
    expect(() => provider.reinstallSettings()).not.toThrow();
  });

  it('installStatusScripts does not throw', () => {
    expect(() => provider.installStatusScripts()).not.toThrow();
  });
});
