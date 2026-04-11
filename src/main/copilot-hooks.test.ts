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
  cleanupHookScripts: vi.fn(),
}));

vi.mock('./platform', () => ({
  isWin: false,
  pythonBin: '/usr/bin/python3',
}));

import * as fs from 'fs';
import * as path from 'path';
import { installCopilotHooks, validateCopilotHooks, cleanupCopilotHooks, COPILOT_HOOK_MARKER } from './copilot-hooks';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

const n = (p: string) => p.replace(/\\/g, '/');

const CONFIG_JSON = path.join('/mock/home', '.copilot', 'config.json');

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
  it('creates config.json with all 4 events on fresh install', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    expect(call).toBeDefined();
    const written = JSON.parse(String(call![1]));
    const hooks = written.hooks;

    expect(hooks.sessionStart).toBeDefined();
    expect(hooks.userPromptSubmitted).toBeDefined();
    expect(hooks.postToolUse).toBeDefined();
    expect(hooks.sessionEnd).toBeDefined();
  });

  it('writes correct status values for each event', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const hooks = JSON.parse(String(call![1])).hooks;

    const getStatusCmd = (event: string) =>
      hooks[event].find((h: any) => h.command?.includes('.status'))?.command;

    expect(getStatusCmd('sessionStart')).toContain('sessionStart:waiting');
    expect(getStatusCmd('userPromptSubmitted')).toContain('userPromptSubmitted:working');
    expect(getStatusCmd('postToolUse')).toContain('postToolUse:working');
    expect(getStatusCmd('sessionEnd')).toContain('sessionEnd:completed');
  });

  it('all hook commands contain the vibeyard marker', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const hooks = JSON.parse(String(call![1])).hooks;

    for (const [, entries] of Object.entries(hooks) as [string, any[]][]) {
      for (const h of entries) {
        const cmd = h.command ?? h.bash ?? h.powershell ?? '';
        expect(cmd).toContain(COPILOT_HOOK_MARKER);
      }
    }
  });

  it('includes session ID capture on sessionStart and userPromptSubmitted only', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const hooks = JSON.parse(String(call![1])).hooks;

    const hasSessionIdCapture = (event: string) =>
      hooks[event]?.some((h: any) => (h.command ?? '').includes('copilot_session_id_capture'));

    expect(hasSessionIdCapture('sessionStart')).toBe(true);
    expect(hasSessionIdCapture('userPromptSubmitted')).toBe(true);
    expect(hasSessionIdCapture('postToolUse')).toBe(false);
    expect(hasSessionIdCapture('sessionEnd')).toBe(false);
  });

  it('session ID capture command uses pythonBin and passes STATUS_DIR as arg (not baked-in)', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const hooks = JSON.parse(String(call![1])).hooks;

    const captureCmd = hooks.sessionStart?.find((h: any) =>
      (h.command ?? '').includes('copilot_session_id_capture')
    )?.command as string | undefined;

    expect(captureCmd).toBeDefined();
    // Uses pythonBin from platform (mocked as /usr/bin/python3)
    expect(captureCmd).toMatch(/python3/);
    // STATUS_DIR passed as CLI arg, not baked into the python code
    expect(captureCmd).toContain('VIBEYARD_SESSION_ID');
  });

  it('preserves existing user hooks', () => {
    const existing = {
      hooks: {
        sessionStart: [{ type: 'command', command: 'echo user-hook' }],
      },
    };

    mockFiles({ [CONFIG_JSON]: JSON.stringify(existing) });
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const hooks = JSON.parse(String(call![1])).hooks;

    const userHook = hooks.sessionStart.find((h: any) => h.command === 'echo user-hook');
    expect(userHook).toBeDefined();

    const vibeyardHook = hooks.sessionStart.find((h: any) =>
      (h.command ?? '').includes(COPILOT_HOOK_MARKER)
    );
    expect(vibeyardHook).toBeDefined();
  });

  it('is idempotent — no duplicate hooks on second run', () => {
    mockFiles({});
    installCopilotHooks();
    const firstCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const firstOutput = String(firstCall![1]);

    mockFiles({ [CONFIG_JSON]: firstOutput });
    mockWriteFileSync.mockClear();

    installCopilotHooks();
    const secondCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const secondOutput = JSON.parse(String(secondCall![1]));
    const firstParsed = JSON.parse(firstOutput);

    for (const event of ['sessionStart', 'userPromptSubmitted', 'postToolUse', 'sessionEnd']) {
      expect(secondOutput.hooks[event]?.length).toBe(firstParsed.hooks[event]?.length);
    }
  });

  it('preserves non-hooks keys in config.json', () => {
    const existing = { version: '2', hooks: {} };
    mockFiles({ [CONFIG_JSON]: JSON.stringify(existing) });

    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const written = JSON.parse(String(call![1]));
    expect(written.version).toBe('2');
  });
});

describe('validateCopilotHooks', () => {
  it('returns complete when all hooks are installed', () => {
    mockFiles({});
    installCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const content = String(call![1]);
    mockFiles({ [CONFIG_JSON]: content });

    const result = validateCopilotHooks();
    expect(result.statusLine).toBe('vibeyard');
    expect(result.hooks).toBe('complete');
    expect(result.hookDetails.sessionStart).toBe(true);
    expect(result.hookDetails.userPromptSubmitted).toBe(true);
    expect(result.hookDetails.postToolUse).toBe(true);
    expect(result.hookDetails.sessionEnd).toBe(true);
  });

  it('returns missing when config.json does not exist', () => {
    mockFiles({});
    const result = validateCopilotHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns missing when hooks are absent', () => {
    mockFiles({ [CONFIG_JSON]: JSON.stringify({ version: '1' }) });
    const result = validateCopilotHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns partial when only some hooks are installed', () => {
    const partial = {
      hooks: {
        sessionStart: [{ type: 'command', command: `echo ${COPILOT_HOOK_MARKER}` }],
        userPromptSubmitted: [{ type: 'command', command: `echo ${COPILOT_HOOK_MARKER}` }],
      },
    };
    mockFiles({ [CONFIG_JSON]: JSON.stringify(partial) });

    const result = validateCopilotHooks();
    expect(result.hooks).toBe('partial');
    expect(result.hookDetails.sessionStart).toBe(true);
    expect(result.hookDetails.userPromptSubmitted).toBe(true);
    expect(result.hookDetails.postToolUse).toBe(false);
    expect(result.hookDetails.sessionEnd).toBe(false);
  });

  it('detects hooks with marker in bash or powershell fields (isIdeHook || fix)', () => {
    // A hook where `command` is missing but `bash` contains the marker.
    // With the old `??` logic this would be missed; with `||` it should be found.
    const config = {
      hooks: {
        sessionStart: [{ type: 'command', bash: `echo status ${COPILOT_HOOK_MARKER}` }],
        userPromptSubmitted: [{ type: 'command', powershell: `echo status ${COPILOT_HOOK_MARKER}` }],
        postToolUse: [{ type: 'command', command: `echo status ${COPILOT_HOOK_MARKER}` }],
        sessionEnd: [{ type: 'command', command: `echo status ${COPILOT_HOOK_MARKER}` }],
      },
    };
    mockFiles({ [CONFIG_JSON]: JSON.stringify(config) });

    const result = validateCopilotHooks();
    expect(result.hooks).toBe('complete');
    expect(result.hookDetails.sessionStart).toBe(true);
    expect(result.hookDetails.userPromptSubmitted).toBe(true);
  });

  it('does NOT detect hooks where command exists but lacks marker (isIdeHook ?? regression check)', () => {
    // `command` is present but does not contain the marker.
    // With old `??` logic the chain would stop at `command` and return false — correct here.
    // But with `||`, it will also check `bash`/`powershell` which are absent — still false. Good.
    const config = {
      hooks: {
        sessionStart: [{ type: 'command', command: 'echo no-marker' }],
      },
    };
    mockFiles({ [CONFIG_JSON]: JSON.stringify(config) });

    const result = validateCopilotHooks();
    expect(result.hookDetails.sessionStart).toBe(false);
  });
});

describe('cleanupCopilotHooks', () => {
  it('removes vibeyard hooks and preserves user hooks', () => {
    const existing = {
      hooks: {
        sessionStart: [
          { type: 'command', command: 'echo user-hook' },
          { type: 'command', command: `echo status ${COPILOT_HOOK_MARKER}` },
        ],
      },
    };

    mockFiles({ [CONFIG_JSON]: JSON.stringify(existing) });
    cleanupCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const written = JSON.parse(String(call![1]));

    expect(written.hooks.sessionStart).toHaveLength(1);
    expect(written.hooks.sessionStart[0].command).toBe('echo user-hook');
  });

  it('removes hooks key when all hooks are vibeyard hooks', () => {
    const existing = {
      version: '1',
      hooks: {
        sessionStart: [{ type: 'command', command: `echo ${COPILOT_HOOK_MARKER}` }],
      },
    };

    mockFiles({ [CONFIG_JSON]: JSON.stringify(existing) });
    cleanupCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const written = JSON.parse(String(call![1]));
    expect(written.hooks).toBeUndefined();
    expect(written.version).toBe('1');
  });

  it('handles missing config.json gracefully', () => {
    mockFiles({});
    expect(() => cleanupCopilotHooks()).not.toThrow();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('removes hooks with marker in bash or powershell fields', () => {
    const existing = {
      hooks: {
        sessionStart: [
          { type: 'command', bash: `echo status ${COPILOT_HOOK_MARKER}` },
          { type: 'command', command: 'echo user-hook' },
        ],
      },
    };

    mockFiles({ [CONFIG_JSON]: JSON.stringify(existing) });
    cleanupCopilotHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_JSON);
    const written = JSON.parse(String(call![1]));
    expect(written.hooks.sessionStart).toHaveLength(1);
    expect(written.hooks.sessionStart[0].command).toBe('echo user-hook');
  });
});
