import { vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
  tmpdir: () => '/tmp',
}));

vi.mock('./hook-commands', () => ({
  installHookScripts: vi.fn(),
  installEventScript: vi.fn(),
  statusCmd: vi.fn((e: string, s: string, _v: string, marker: string) => `echo ${e}:${s} > $VIBEYARD_SESSION_ID.status ${marker}`),
  captureSessionIdCmd: vi.fn((_v: string, marker: string) => `capture .sessionid $VIBEYARD_SESSION_ID ${marker}`),
  wrapPythonHookCmd: vi.fn((_name: string, _code: string, marker: string) => `capture-event $VIBEYARD_SESSION_ID .events ${marker}`),
  cleanupHookScripts: vi.fn(),
  VIBEYARD_HOOK_MARKER: '# vibeyard-hook',
}));

import * as fs from 'fs';
import * as path from 'path';
import { installCopilotHooks, validateCopilotHooks, cleanupCopilotHooks, COPILOT_HOOK_MARKER } from './copilot-hooks';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

const n = (p: string) => p.replace(/\\/g, '/');

const CONFIG_PATH = path.join('/mock/home', '.copilot', 'config.json');

function mockFiles(rawFiles: Record<string, string>): void {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFiles)) files[n(k)] = v;
  mockReadFileSync.mockImplementation((p: any) => {
    const content = files[n(String(p))];
    if (content !== undefined) return content;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('installCopilotHooks', () => {
  it('creates config.json with all 5 events on fresh install', () => {
    mockFiles({});
    installCopilotHooks();

    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.join('/mock/home', '.copilot'),
      { recursive: true }
    );

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    expect(call).toBeDefined();
    const written = JSON.parse(String(call![1]));
    const hooks = written.hooks;

    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.UserPromptSubmit).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.Stop).toBeDefined();
    expect(hooks.PreToolUse).toBeDefined();
  });

  it('writes correct status values for each event', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const hooks = JSON.parse(String(call![1])).hooks;

    const getStatusCmd = (event: string) =>
      hooks[event].find((m: any) => m.hooks.some((h: any) => h.command.includes('.status')))
        ?.hooks.find((h: any) => h.command.includes('.status'))?.command;

    expect(getStatusCmd('SessionStart')).toContain('SessionStart:waiting');
    expect(getStatusCmd('UserPromptSubmit')).toContain('UserPromptSubmit:working');
    expect(getStatusCmd('PostToolUse')).toContain('PostToolUse:working');
    expect(getStatusCmd('Stop')).toContain('Stop:completed');
  });

  it('includes session ID capture on SessionStart and UserPromptSubmit only', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const hooks = JSON.parse(String(call![1])).hooks;

    const hasSessionIdCapture = (event: string) =>
      hooks[event]?.some((m: any) =>
        m.hooks.some((h: any) => h.command.includes('.sessionid'))
      );

    expect(hasSessionIdCapture('SessionStart')).toBe(true);
    expect(hasSessionIdCapture('UserPromptSubmit')).toBe(true);
    expect(hasSessionIdCapture('PostToolUse')).toBe(false);
    expect(hasSessionIdCapture('Stop')).toBe(false);
  });

  it('all hook commands contain the vibeyard marker', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const hooks = JSON.parse(String(call![1])).hooks;

    for (const [, matchers] of Object.entries(hooks) as [string, any[]][]) {
      for (const matcher of matchers) {
        for (const h of matcher.hooks) {
          expect(h.command).toContain(COPILOT_HOOK_MARKER);
        }
      }
    }
  });

  it('all hook commands reference $VIBEYARD_SESSION_ID', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const hooks = JSON.parse(String(call![1])).hooks;

    for (const [, matchers] of Object.entries(hooks) as [string, any[]][]) {
      for (const matcher of matchers) {
        for (const h of matcher.hooks) {
          expect(h.command).toContain('VIBEYARD_SESSION_ID');
        }
      }
    }
  });

  it('preserves existing user hooks', () => {
    const existing = {
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{ type: 'command', command: 'echo user-hook' }],
        }],
      },
    };

    mockFiles({ [CONFIG_PATH]: JSON.stringify(existing) });
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const hooks = JSON.parse(String(call![1])).hooks;

    const userMatcher = hooks.SessionStart.find(
      (m: any) => m.hooks.some((h: any) => h.command === 'echo user-hook')
    );
    expect(userMatcher).toBeDefined();

    const vibeyardMatcher = hooks.SessionStart.find(
      (m: any) => m.hooks.some((h: any) => h.command.includes(COPILOT_HOOK_MARKER))
    );
    expect(vibeyardMatcher).toBeDefined();
  });

  it('is idempotent — no duplicate hooks on second run', () => {
    mockFiles({});
    installCopilotHooks();

    const firstCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const firstOutput = String(firstCall![1]);

    mockFiles({ [CONFIG_PATH]: firstOutput });
    mockWriteFileSync.mockClear();

    installCopilotHooks();
    const secondCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const secondOutput = JSON.parse(String(secondCall![1]));
    const firstParsed = JSON.parse(firstOutput);

    for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'PreToolUse']) {
      expect(secondOutput.hooks[event]?.length).toBe(firstParsed.hooks[event]?.length);
    }
  });

  it('preserves non-hooks keys in config.json', () => {
    const existing = {
      version: '1.0',
      hooks: {},
    };

    mockFiles({ [CONFIG_PATH]: JSON.stringify(existing) });
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const written = JSON.parse(String(call![1]));
    expect(written.version).toBe('1.0');
  });
});

describe('validateCopilotHooks', () => {
  it('returns complete when all expected hooks are installed', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const configContent = String(call![1]);
    mockFiles({ [CONFIG_PATH]: configContent });

    const result = validateCopilotHooks();
    expect(result.statusLine).toBe('vibeyard');
    expect(result.hooks).toBe('complete');
    expect(result.hookDetails.SessionStart).toBe(true);
    expect(result.hookDetails.UserPromptSubmit).toBe(true);
    expect(result.hookDetails.PostToolUse).toBe(true);
    expect(result.hookDetails.Stop).toBe(true);
  });

  it('returns missing when config.json does not exist', () => {
    mockFiles({});

    const result = validateCopilotHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns missing when config.json exists but has no hooks', () => {
    mockFiles({ [CONFIG_PATH]: JSON.stringify({ version: '1.0' }) });

    const result = validateCopilotHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns partial when some hooks are missing', () => {
    const partial = {
      hooks: {
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: `echo test ${COPILOT_HOOK_MARKER}` }] }],
        UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: `echo test ${COPILOT_HOOK_MARKER}` }] }],
      },
    };

    mockFiles({ [CONFIG_PATH]: JSON.stringify(partial) });

    const result = validateCopilotHooks();
    expect(result.hooks).toBe('partial');
    expect(result.hookDetails.SessionStart).toBe(true);
    expect(result.hookDetails.UserPromptSubmit).toBe(true);
    expect(result.hookDetails.PostToolUse).toBe(false);
    expect(result.hookDetails.Stop).toBe(false);
  });
});

describe('cleanupCopilotHooks', () => {
  it('removes vibeyard hooks and preserves user hooks', () => {
    const existing = {
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-hook' }] },
          { matcher: '', hooks: [{ type: 'command', command: `echo status ${COPILOT_HOOK_MARKER}` }] },
        ],
      },
    };

    mockFiles({ [CONFIG_PATH]: JSON.stringify(existing) });
    cleanupCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const written = JSON.parse(String(call![1]));

    expect(written.hooks.SessionStart).toHaveLength(1);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe('echo user-hook');
  });

  it('removes hooks key when all hooks are vibeyard hooks', () => {
    const existing = {
      version: '1.0',
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: `echo ${COPILOT_HOOK_MARKER}` }] },
        ],
      },
    };

    mockFiles({ [CONFIG_PATH]: JSON.stringify(existing) });
    cleanupCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(CONFIG_PATH));
    const written = JSON.parse(String(call![1]));
    expect(written.hooks).toBeUndefined();
    expect(written.version).toBe('1.0');
  });

  it('handles missing config.json gracefully', () => {
    mockFiles({});
    expect(() => cleanupCopilotHooks()).not.toThrow();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
