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

import * as fs from 'fs';
import { execSync } from 'child_process';
import { AntigravityProvider, _resetCachedPath } from './antigravity-provider';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockStatSync = vi.mocked(fs.statSync);
const mockExecSync = vi.mocked(execSync);
const fileStat = { isFile: () => true } as fs.Stats;

let provider: AntigravityProvider;

beforeEach(() => {
  vi.clearAllMocks();
  mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
  _resetCachedPath();
  provider = new AntigravityProvider();
});

describe('meta', () => {
  it('has correct id, displayName, and binaryName', () => {
    expect(provider.meta.id).toBe('antigravity');
    expect(provider.meta.displayName).toBe('Antigravity CLI');
    expect(provider.meta.binaryName).toBe('agy');
  });

  it('declares MVP capabilities (everything advanced off)', () => {
    const caps = provider.meta.capabilities;
    expect(caps.sessionResume).toBe(false);
    expect(caps.costTracking).toBe(false);
    expect(caps.contextWindow).toBe(false);
    expect(caps.hookStatus).toBe(false);
    expect(caps.configReading).toBe(false);
    expect(caps.shiftEnterNewline).toBe(false);
    expect(caps.pendingPromptTrigger).toBe('startup-arg');
    expect(caps.systemPromptInjection).toBe(false);
  });

  it('has defaultContextWindowSize of 1,000,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(1_000_000);
  });
});

describe('resolveBinaryPath', () => {
  const firstCandidate = isWin
    ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'agy.cmd')
    : '/usr/local/bin/agy';

  it('returns candidate path when statSync finds a file', () => {
    mockStatSync.mockImplementation((p) => {
      if (p === firstCandidate) return fileStat;
      throw new Error('ENOENT');
    });
    expect(provider.resolveBinaryPath()).toBe(firstCandidate);
  });

  it(`falls back to ${isWin ? 'where' : 'which'} agy when no candidate exists`, () => {
    mockExecSync.mockReturnValue('/some/other/path/agy\n' as any);
    expect(provider.resolveBinaryPath()).toBe('/some/other/path/agy');
  });

  it('falls back to bare "agy" when both candidate and which fail', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(provider.resolveBinaryPath()).toBe('agy');
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
  it('returns true when binary found via which', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/resolved/agy\n' as any);
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

  it('preserves existing env vars', () => {
    const env = provider.buildEnv('sess-123', { ANTIGRAVITY_API_KEY: 'key123', OTHER: 'val' });
    expect(env.ANTIGRAVITY_API_KEY).toBe('key123');
    expect(env.OTHER).toBe('val');
  });
});

describe('buildArgs', () => {
  it('returns [] with no prompt or extra args', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('ignores resume in v1 (sessionResume capability is off)', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('splits extraArgs on whitespace and appends', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--sandbox  --add-dir /tmp' });
    expect(args).toEqual(['--sandbox', '--add-dir', '/tmp']);
  });

  it('appends -i flag when initialPrompt is provided', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: 'Fix the build' });
    expect(args).toEqual(['-i', 'Fix the build']);
  });

  it('emits extraArgs before the initial prompt', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--sandbox', initialPrompt: 'Go' });
    expect(args).toEqual(['--sandbox', '-i', 'Go']);
  });

  it('does not emit a system-prompt flag (no documented flag; team chat is gated off this provider)', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', systemPrompt: 'You are the CMO.' });
    expect(args).not.toContain('--system-prompt');
    expect(args).not.toContain('You are the CMO.');
  });
});

describe('stubbed methods', () => {
  it('getShiftEnterSequence returns null', () => {
    expect(provider.getShiftEnterSequence()).toBeNull();
  });

  it('getConfig returns an empty config', async () => {
    await expect(provider.getConfig('/some/path')).resolves.toEqual({ mcpServers: [], agents: [], skills: [], commands: [] });
  });

  it('validateSettings reports missing status line and hooks', () => {
    expect(provider.validateSettings()).toEqual({ statusLine: 'missing', hooks: 'missing', hookDetails: {} });
  });

  it('lifecycle no-ops do not throw', async () => {
    await expect(provider.installHooks()).resolves.toBeUndefined();
    expect(() => provider.installStatusScripts()).not.toThrow();
    expect(() => provider.cleanup()).not.toThrow();
    expect(() => provider.reinstallSettings()).not.toThrow();
  });
});
