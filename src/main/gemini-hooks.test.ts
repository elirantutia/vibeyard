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
  statusCmd: vi.fn((e: string, s: string, _v: string, marker: string) => `echo ${e}:${s} > $VIBEYARD_SESSION_ID.status ${marker}`),
  captureSessionIdCmd: vi.fn((_v: string, marker: string) => `capture .sessionid $VIBEYARD_SESSION_ID ${marker}`),
  captureToolFailureCmd: vi.fn((_v: string, marker: string) => `capture-toolfailure ${marker}`),
  wrapPythonHookCmd: vi.fn((_name: string, _code: string, marker: string) => `capture-event $VIBEYARD_SESSION_ID .events ${marker}`),
  cleanupHookScripts: vi.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import { installGeminiHooks, validateGeminiHooks, cleanupGeminiHooks, GEMINI_HOOK_MARKER } from './gemini-hooks';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);

const n = (p: string) => p.replace(/\\/g, '/');

const SETTINGS_PATH = path.join('/mock/home', '.gemini', 'settings.json');

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

describe('installGeminiHooks', () => {
  it('creates settings.json with hooks on fresh install', () => {
    mockFiles({});
    installGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    expect(call).toBeDefined();
    const written = JSON.parse(String(call![1]));
    const hooks = written.hooks;

    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.BeforeAgent).toBeDefined();
    expect(hooks.AfterTool).toBeDefined();
    expect(hooks.AfterAgent).toBeDefined();
    expect(hooks.SessionEnd).toBeDefined();
  });

  it('all hook commands contain the vibeyard marker', () => {
    mockFiles({});
    installGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const hooks = JSON.parse(String(call![1])).hooks;

    for (const [, matchers] of Object.entries(hooks) as [string, any[]][]) {
      for (const matcher of matchers) {
        for (const h of matcher.hooks) {
          expect(h.command).toContain(GEMINI_HOOK_MARKER);
        }
      }
    }
  });

  it('all hook commands reference $VIBEYARD_SESSION_ID', () => {
    mockFiles({});
    installGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const hooks = JSON.parse(String(call![1])).hooks;

    for (const [, matchers] of Object.entries(hooks) as [string, any[]][]) {
      for (const matcher of matchers) {
        for (const h of matcher.hooks) {
          expect(h.command).toContain('VIBEYARD_SESSION_ID');
        }
      }
    }
  });

  it('preserves existing settings keys', () => {
    mockFiles({
      [SETTINGS_PATH]: JSON.stringify({ theme: 'dark', mcpServers: { test: { command: 'test' } } }),
    });
    installGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const written = JSON.parse(String(call![1]));
    expect(written.theme).toBe('dark');
    expect(written.mcpServers.test.command).toBe('test');
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

    mockFiles({ [SETTINGS_PATH]: JSON.stringify(existing) });
    installGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const hooks = JSON.parse(String(call![1])).hooks;

    const userMatcher = hooks.SessionStart.find(
      (m: any) => m.hooks.some((h: any) => h.command === 'echo user-hook')
    );
    expect(userMatcher).toBeDefined();

    const vibeyardMatcher = hooks.SessionStart.find(
      (m: any) => m.hooks.some((h: any) => h.command.includes(GEMINI_HOOK_MARKER))
    );
    expect(vibeyardMatcher).toBeDefined();
  });

  it('is idempotent — no duplicate hooks on second run', () => {
    mockFiles({});
    installGeminiHooks();
    const firstCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const firstOutput = String(firstCall![1]);

    mockFiles({ [SETTINGS_PATH]: firstOutput });
    mockWriteFileSync.mockClear();

    installGeminiHooks();
    const secondCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const secondOutput = JSON.parse(String(secondCall![1]));
    const firstParsed = JSON.parse(firstOutput);

    for (const event of ['SessionStart', 'BeforeAgent', 'AfterTool', 'AfterAgent', 'SessionEnd']) {
      expect(secondOutput.hooks[event]?.length).toBe(firstParsed.hooks[event]?.length);
    }
  });

  it('writes correct status values for each event', () => {
    mockFiles({});
    installGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const hooks = JSON.parse(String(call![1])).hooks;

    const getStatusCmd = (event: string) =>
      hooks[event].find((m: any) => m.hooks.some((h: any) => h.command.includes('.status')))
        ?.hooks.find((h: any) => h.command.includes('.status'))?.command;

    expect(getStatusCmd('SessionStart')).toContain('SessionStart:waiting');
    expect(getStatusCmd('BeforeAgent')).toContain('BeforeAgent:working');
    expect(getStatusCmd('AfterTool')).toContain('AfterTool:working');
    expect(getStatusCmd('AfterAgent')).toContain('AfterAgent:completed');
    expect(getStatusCmd('SessionEnd')).toContain('SessionEnd:completed');
  });

  it('includes session ID capture on SessionStart and BeforeAgent only', () => {
    mockFiles({});
    installGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const hooks = JSON.parse(String(call![1])).hooks;

    const hasSessionIdCapture = (event: string) =>
      hooks[event]?.some((m: any) =>
        m.hooks.some((h: any) => h.name === 'vibeyard-sessionid')
      );

    expect(hasSessionIdCapture('SessionStart')).toBe(true);
    expect(hasSessionIdCapture('BeforeAgent')).toBe(true);
    expect(hasSessionIdCapture('AfterTool')).toBe(false);
    expect(hasSessionIdCapture('AfterAgent')).toBe(false);
    expect(hasSessionIdCapture('SessionEnd')).toBe(false);
  });
});

describe('validateGeminiHooks', () => {
  it('returns complete when all hooks are installed', () => {
    mockFiles({});
    installGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const content = String(call![1]);
    mockFiles({ [SETTINGS_PATH]: content });

    const result = validateGeminiHooks();
    expect(result.statusLine).toBe('vibeyard');
    expect(result.hooks).toBe('complete');
    expect(result.hookDetails.SessionStart).toBe(true);
    expect(result.hookDetails.BeforeAgent).toBe(true);
    expect(result.hookDetails.AfterTool).toBe(true);
    expect(result.hookDetails.AfterAgent).toBe(true);
    expect(result.hookDetails.SessionEnd).toBe(true);
  });

  it('returns missing when settings.json does not exist', () => {
    mockFiles({});

    const result = validateGeminiHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns missing when no hooks key in settings', () => {
    mockFiles({ [SETTINGS_PATH]: JSON.stringify({ theme: 'dark' }) });

    const result = validateGeminiHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns partial when some hooks are missing', () => {
    const partial = {
      hooks: {
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: `echo test ${GEMINI_HOOK_MARKER}` }] }],
        BeforeAgent: [{ matcher: '', hooks: [{ type: 'command', command: `echo test ${GEMINI_HOOK_MARKER}` }] }],
      },
    };

    mockFiles({ [SETTINGS_PATH]: JSON.stringify(partial) });

    const result = validateGeminiHooks();
    expect(result.hooks).toBe('partial');
    expect(result.hookDetails.SessionStart).toBe(true);
    expect(result.hookDetails.BeforeAgent).toBe(true);
    expect(result.hookDetails.AfterTool).toBe(false);
    expect(result.hookDetails.SessionEnd).toBe(false);
  });
});

describe('cleanupGeminiHooks', () => {
  it('removes vibeyard hooks and preserves user hooks', () => {
    const existing = {
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-hook' }] },
          { matcher: '', hooks: [{ type: 'command', command: `echo status ${GEMINI_HOOK_MARKER}` }] },
        ],
      },
    };

    mockFiles({ [SETTINGS_PATH]: JSON.stringify(existing) });
    cleanupGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const written = JSON.parse(String(call![1]));

    expect(written.hooks.SessionStart).toHaveLength(1);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe('echo user-hook');
  });

  it('removes hooks key when all hooks are vibeyard hooks', () => {
    const existing = {
      theme: 'dark',
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: `echo ${GEMINI_HOOK_MARKER}` }] },
        ],
      },
    };

    mockFiles({ [SETTINGS_PATH]: JSON.stringify(existing) });
    cleanupGeminiHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === SETTINGS_PATH);
    const written = JSON.parse(String(call![1]));
    expect(written.hooks).toBeUndefined();
    expect(written.theme).toBe('dark');
  });

  it('handles missing settings.json gracefully', () => {
    mockFiles({});
    expect(() => cleanupGeminiHooks()).not.toThrow();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
