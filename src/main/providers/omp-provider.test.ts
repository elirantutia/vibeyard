import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  promises: { readFile: vi.fn() },
}));
vi.mock('os', () => ({ homedir: () => '/mock/home' }));
vi.mock('../pty-manager', () => ({ getFullPath: () => '/usr/local/bin:/usr/bin' }));
vi.mock('./resolve-binary', () => ({ resolveBinary: vi.fn(), validateBinaryExists: vi.fn() }));
vi.mock('../omp-session-watcher', () => ({
  startOmpSessionWatcher: vi.fn(),
  registerPendingOmpSession: vi.fn(),
  unregisterOmpSession: vi.fn(),
  stopOmpSessionWatcher: vi.fn(),
}));
vi.mock('./omp-transcripts', () => ({
  ompSessionsRoot: vi.fn((configDir?: string) => require('path').join(configDir ?? '/mock/home/.omp/agent', 'sessions')),
  readTranscriptTitleSync: vi.fn(),
}));
vi.mock('./pi-compatible-transcripts', () => ({
  createCompatibleTranscriptModule: (dir: string) => ({
    agentDir: (configDir?: string) => configDir ?? dir,
    sessionsRoot: (configDir?: string) => require('path').join(configDir ?? dir, 'sessions'),
  }),
  findTranscriptPathSync: vi.fn(),
  scanTranscriptSessionsRoot: vi.fn(),
  indexCompatibleTranscript: vi.fn(),
  readTranscriptStatusSync: vi.fn(),
  readSessionExitReasonSync: vi.fn(),
}));

import { resolveBinary, validateBinaryExists } from './resolve-binary';
import { startOmpSessionWatcher, registerPendingOmpSession, unregisterOmpSession } from '../omp-session-watcher';
import { readTranscriptTitleSync } from './omp-transcripts';
import { findTranscriptPathSync, readTranscriptStatusSync, readSessionExitReasonSync } from './pi-compatible-transcripts';
import { OmpProvider, _resetCachedPath } from './omp-provider';

const mockResolveBinary = vi.mocked(resolveBinary);
const mockValidateBinaryExists = vi.mocked(validateBinaryExists);
const mockStartOmpSessionWatcher = vi.mocked(startOmpSessionWatcher);
const mockRegisterPendingOmpSession = vi.mocked(registerPendingOmpSession);
const mockUnregisterOmpSession = vi.mocked(unregisterOmpSession);

let provider: OmpProvider;

beforeEach(() => {
  vi.clearAllMocks();
  _resetCachedPath();
  provider = new OmpProvider();
});

describe('meta', () => {
  it('has correct id, displayName, and binaryName', () => {
    expect(provider.meta.id).toBe('omp');
    expect(provider.meta.displayName).toBe('Oh my Pi');
    expect(provider.meta.binaryName).toBe('omp');
  });

  it('declares resume + system-prompt injection, no hooks/cost/context', () => {
    const caps = provider.meta.capabilities;
    expect(caps.sessionResume).toBe(true);
    expect(caps.costTracking).toBe(false);
    expect(caps.contextWindow).toBe(false);
    expect(caps.hookStatus).toBe(false);
    expect(caps.configReading).toBe(false);
    expect(caps.shiftEnterNewline).toBe(false);
    expect(caps.pendingPromptTrigger).toBe('startup-arg');
    expect(caps.systemPromptInjection).toBe(true);
    expect(caps.planModeArg).toBeUndefined();
  });

  it('has defaultContextWindowSize of 200,000', () => {
    expect(provider.meta.defaultContextWindowSize).toBe(200_000);
  });
});

describe('resolveBinaryPath / validatePrerequisites', () => {
  it('delegates to the binary helpers with "omp"', () => {
    mockResolveBinary.mockReturnValue('/bin/omp');
    expect(provider.resolveBinaryPath()).toBe('/bin/omp');
    expect(mockResolveBinary).toHaveBeenCalledWith('omp', expect.anything());
    mockValidateBinaryExists.mockReturnValue(true);
    expect(provider.validatePrerequisites()).toBe(true);
    expect(mockValidateBinaryExists).toHaveBeenCalledWith('omp');
  });
});

describe('buildEnv', () => {
  it('sets PATH to the augmented PATH and preserves existing vars', () => {
    const env = provider.buildEnv('sess-1', { FOO: 'bar' });
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin');
    expect(env.FOO).toBe('bar');
    expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
  });

  it('sets PI_CODING_AGENT_DIR when a configDir is given', () => {
    const env = provider.buildEnv('sess-1', {}, { configDir: '/profiles/work' });
    expect(env.PI_CODING_AGENT_DIR).toBe('/profiles/work');
  });

  it('strips an inherited PI_CODING_AGENT_DIR when no configDir is given', () => {
    const env = provider.buildEnv('sess-1', { PI_CODING_AGENT_DIR: '/pi/profiles/olla' });
    expect(env.PI_CODING_AGENT_DIR).toBeUndefined();
  });

  it('strips inherited OMP/PI native profile and storage selectors case-insensitively', () => {
    const env = provider.buildEnv('sess-1', {
      Omp_Profile: 'audit-example',
      PI_PROFILE: 'legacy',
      Pi_Config_Dir: '/inherited',
      PI_CODING_AGENT_SESSION_DIR: '/sessions',
      SAFE: 'yes',
    });
    expect(env.OMP_PROFILE).toBeUndefined();
    expect(env.Omp_Profile).toBeUndefined();
    expect(env.PI_PROFILE).toBeUndefined();
    expect(env.PI_CONFIG_DIR).toBeUndefined();
    expect(env.PI_CODING_AGENT_SESSION_DIR).toBeUndefined();
    expect(env.SAFE).toBe('yes');
  });

  it('keeps the pinned profile when a configDir is given (default vs custom)', () => {
    const env = provider.buildEnv('sess-1', { PI_CODING_AGENT_DIR: '/inherited', OMP_PROFILE: 'intruder' }, { configDir: '/profiles/work' });
    expect(env.PI_CODING_AGENT_DIR).toBe('/profiles/work');
    expect(env.OMP_PROFILE).toBeUndefined();
  });
});

describe('buildArgs', () => {
  it('returns [] for a fresh session with no extras', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '' })).toEqual([]);
  });

  it('returns ["--resume", id] when resuming', () => {
    expect(provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '' }))
      .toEqual(['--resume', 'sid-1']);
  });

  it('omits --resume when isResume=false', () => {
    expect(provider.buildArgs({ cliSessionId: 'sid-1', isResume: false, extraArgs: '' })).toEqual([]);
  });

  it('splits extraArgs on whitespace and appends', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--provider olla  --model thinking' }))
      .toEqual(['--provider', 'olla', '--model', 'thinking']);
  });

  it('appends --append-system-prompt when systemPrompt is provided', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', systemPrompt: 'You are the CMO.' }))
      .toEqual(['--append-system-prompt', 'You are the CMO.']);
  });

  it('appends initialPrompt as a positional message arg', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: 'Fix the bug' }))
      .toEqual(['Fix the bug']);
  });

  it('combines resume, extraArgs, systemPrompt, and initialPrompt', () => {
    expect(provider.buildArgs({ cliSessionId: 'sid-1', isResume: true, extraArgs: '--model x', systemPrompt: 'sp', initialPrompt: 'go' }))
      .toEqual(['--resume', 'sid-1', '--model', 'x', '--append-system-prompt', 'sp', 'go']);
  });

  it('tokenizes quoted extra args (spaces stay inside one argument)', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--append-system-prompt "Use concise replies"' }))
      .toEqual(['--append-system-prompt', 'Use concise replies']);
  });

  it('preserves empty quoted extra args', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '--flag ""' }))
      .toEqual(['--flag', '']);
  });

  it('keeps a system prompt starting with option characters as one argument', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', systemPrompt: '--foo bar' }))
      .toEqual(['--append-system-prompt', '--foo bar']);
  });

  it('keeps an initial prompt starting with option characters as one argument', () => {
    expect(provider.buildArgs({ cliSessionId: null, isResume: false, extraArgs: '', initialPrompt: '--foo' }))
      .toEqual(['--foo']);
  });
});

describe('no-op lifecycle methods', () => {
  it('installHooks resolves without side effects', async () => {
    await expect(provider.installHooks()).resolves.toBeUndefined();
  });

  it('installStatusScripts / cleanup / reinstallSettings do not throw', () => {
    expect(() => provider.installStatusScripts()).not.toThrow();
    expect(() => provider.cleanup()).not.toThrow();
    expect(() => provider.reinstallSettings()).not.toThrow();
  });

  it('validateSettings reports complete (OMP has no hooks or status line)', () => {
    expect(provider.validateSettings()).toEqual({ statusLine: 'vibeyard', hooks: 'complete', hookDetails: {} });
  });

  it('getShiftEnterSequence returns null', () => {
    expect(provider.getShiftEnterSequence()).toBeNull();
  });
});

describe('session id discovery hooks', () => {
  it('onSessionStarted starts the watcher and registers the pending session', () => {
    provider.onSessionStarted!('ui-1', '/proj', {} as any, '/profiles/work');
    expect(mockStartOmpSessionWatcher).toHaveBeenCalled();
    expect(mockRegisterPendingOmpSession).toHaveBeenCalledWith('ui-1', '/proj', '/profiles/work');
  });

  it('onSessionExited unregisters the pending session', () => {
    provider.onSessionExited!('ui-1');
    expect(mockUnregisterOmpSession).toHaveBeenCalledWith('ui-1');
  });
  it('readSessionTitle reads the title from the given transcript path', () => {
    vi.mocked(readTranscriptTitleSync).mockReturnValue('My CLI title');

    expect(provider.readSessionTitle!('/sessions/dir-a/2026.jsonl')).toBe('My CLI title');
    expect(readTranscriptTitleSync).toHaveBeenCalledWith('/sessions/dir-a/2026.jsonl');
  });

  it('readSessionTitle returns null when the transcript has no title', () => {
    vi.mocked(readTranscriptTitleSync).mockReturnValue(null);

    expect(provider.readSessionTitle!('/sessions/dir-a/2026.jsonl')).toBeNull();
  });
});

describe('readSessionStatus', () => {
  it('derives status from the given transcript tail', () => {
    vi.mocked(readTranscriptStatusSync).mockReturnValue('working');

    expect(provider.readSessionStatus!('/sessions/dir-a/2026.jsonl')).toBe('working');
    expect(readTranscriptStatusSync).toHaveBeenCalledWith('/sessions/dir-a/2026.jsonl');
  });

  it('returns null when the tail yields no status', () => {
    vi.mocked(readTranscriptStatusSync).mockReturnValue(null);

    expect(provider.readSessionStatus!('/sessions/dir-a/2026.jsonl')).toBeNull();
  });
});

describe('readSessionExitReason', () => {
  it('reads the exit reason from the given transcript path', () => {
    vi.mocked(readSessionExitReasonSync).mockReturnValue({ reason: 'unhandled_rejection', kind: 'fatal' });

    expect(provider.readSessionExitReason!('/sessions/dir-a/2026.jsonl')).toEqual({ reason: 'unhandled_rejection', kind: 'fatal' });
    expect(readSessionExitReasonSync).toHaveBeenCalledWith('/sessions/dir-a/2026.jsonl');
  });

  it('returns null when the transcript has no session_exit', () => {
    vi.mocked(readSessionExitReasonSync).mockReturnValue(null);

    expect(provider.readSessionExitReason!('/sessions/dir-a/2026.jsonl')).toBeNull();
  });
});

describe('getTranscriptPath', () => {
  it('resolves the transcript path the sync caches and reads from', () => {
    vi.mocked(findTranscriptPathSync).mockReturnValue('/sessions/dir-a/2026.jsonl');

    expect(provider.getTranscriptPath!('cli-9', '/proj', '/profiles/work')).toBe('/sessions/dir-a/2026.jsonl');
    expect(findTranscriptPathSync).toHaveBeenCalledWith(expect.any(Function), 'cli-9', '/proj', '/profiles/work');
  });
});

describe('getConfig', () => {
  it('returns an empty config (OMP config is YAML, not surfaced)', async () => {
    await expect(provider.getConfig('/some/path')).resolves.toEqual({
      mcpServers: [], agents: [], skills: [], commands: [],
    });
  });
});
