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

vi.mock('../hook-status', () => ({
  getStatusLineScriptPath: vi.fn(() => '/tmp/vibeyard/statusline.sh'),
  installStatusLineScript: vi.fn(),
  cleanupAll: vi.fn(),
}));

vi.mock('../claude-cli', () => ({
  installHooks: vi.fn(),
  getClaudeConfig: vi.fn(),
}));

import * as fs from 'fs';
import { execSync } from 'child_process';
import { ClaudeProvider, _resetCachedPath } from './claude-provider';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockExecSync = vi.mocked(execSync);

let provider: ClaudeProvider;

beforeEach(() => {
  vi.clearAllMocks();
  _resetCachedPath();
  provider = new ClaudeProvider();
});

describe('meta', () => {
  it('has correct id, displayName, and binaryName', () => {
    expect(provider.meta.id).toBe('claude');
    expect(provider.meta.displayName).toBe('Claude Code');
    expect(provider.meta.binaryName).toBe('claude');
  });

  it('has all capabilities set to true', () => {
    const caps = provider.meta.capabilities;
    expect(caps.sessionResume).toBe(true);
    expect(caps.costTracking).toBe(true);
    expect(caps.contextWindow).toBe(true);
    expect(caps.hookStatus).toBe(true);
    expect(caps.configReading).toBe(true);
    expect(caps.shiftEnterNewline).toBe(true);
    expect(caps.pendingPromptTrigger).toBe('startup-arg');
    expect(caps.planModeArg).toBe('--permission-mode plan');
  });

  it('has defaultContextWindowSize of 200,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(200_000);
  });
});

describe('resolveBinaryPath', () => {
  it('returns candidate path when existsSync returns true', () => {
    mockExistsSync.mockImplementation((p) => p === '/usr/local/bin/claude');
    expect(provider.resolveBinaryPath()).toBe('/usr/local/bin/claude');
  });

  it('falls back to which claude when no candidate exists', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/some/other/path/claude\n' as any);
    expect(provider.resolveBinaryPath()).toBe('/some/other/path/claude');
  });

  it('falls back to bare "claude" when both candidate and which fail', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    expect(provider.resolveBinaryPath()).toBe('claude');
  });

  it('caches result on subsequent calls', () => {
    mockExistsSync.mockImplementation((p) => p === '/usr/local/bin/claude');
    provider.resolveBinaryPath();
    mockExistsSync.mockReturnValue(false); // change behavior
    // Should still return cached value
    expect(provider.resolveBinaryPath()).toBe('/usr/local/bin/claude');
  });
});

describe('validatePrerequisites', () => {
  it('returns ok when binary found via existsSync', () => {
    mockExistsSync.mockImplementation((p) => p === '/opt/homebrew/bin/claude');
    expect(provider.validatePrerequisites()).toEqual({ ok: true, message: '' });
  });

  it('returns ok when binary found via which', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockReturnValue('/resolved/claude\n' as any);
    expect(provider.validatePrerequisites()).toEqual({ ok: true, message: '' });
  });

  it('returns not ok when binary not found anywhere', () => {
    mockExistsSync.mockReturnValue(false);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    const result = provider.validatePrerequisites();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Claude Code CLI not found');
  });
});

describe('buildEnv', () => {
  it('sets CLAUDE_IDE_SESSION_ID to the session ID', () => {
    const env = provider.buildEnv('sess-123', {});
    expect(env.CLAUDE_IDE_SESSION_ID).toBe('sess-123');
  });

  it('sets PATH to the augmented PATH', () => {
    const env = provider.buildEnv('sess-123', {});
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
  });

  it('deletes CLAUDE_CODE from env if present', () => {
    const env = provider.buildEnv('sess-123', { CLAUDE_CODE: '1', OTHER: 'val' });
    expect(env.CLAUDE_CODE).toBeUndefined();
    expect(env.OTHER).toBe('val');
  });
});

describe('buildArgs', () => {
  it('returns ["-r", id] when isResume=true with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '' });
    expect(args).toEqual(['-r', 'sid-1']);
  });

  it('returns ["--session-id", id] when isResume=false with cliSessionId', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: false, extraArgs: '' });
    expect(args).toEqual(['--session-id', 'sid-1']);
  });

  it('returns [] when cliSessionId is null', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' });
    expect(args).toEqual([]);
  });

  it('splits extraArgs on whitespace and appends', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--verbose  --debug' });
    expect(args).toEqual(['--verbose', '--debug']);
  });

  it('combines session args and extra args', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '--verbose' });
    expect(args).toEqual(['-r', 'sid-1', '--verbose']);
  });

  it('passes initialPrompt as positional arg', () => {
    const args = provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: 'fix the linter' });
    expect(args).toEqual(['fix the linter']);
  });

  it('passes initialPrompt after session-id args', () => {
    const args = provider.buildArgs({ cliSessionId: 'sid-1', isResume: false, extraArgs: '', initialPrompt: 'fix the linter' });
    expect(args).toEqual(['--session-id', 'sid-1', 'fix the linter']);
  });
});

describe('getShiftEnterSequence', () => {
  it('returns the kitty keyboard protocol sequence', () => {
    expect(provider.getShiftEnterSequence()).toBe('\x1b[13;2u');
  });
});

describe('parseCostFromOutput', () => {
  it('extracts last $X.XX match from text', () => {
    const result = provider.parseCostFromOutput('Total cost: $1.23');
    expect(result).toEqual({ totalCostUsd: 1.23 });
  });

  it('returns null when no cost pattern found', () => {
    expect(provider.parseCostFromOutput('no costs here')).toBeNull();
  });

  it('handles multiple cost values and picks last one', () => {
    const result = provider.parseCostFromOutput('Cost: $0.50 then $1.75 then $3.20');
    expect(result).toEqual({ totalCostUsd: 3.20 });
  });
});
