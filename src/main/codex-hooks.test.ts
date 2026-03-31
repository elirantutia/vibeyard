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

import * as fs from 'fs';
import { installCodexHooks, validateCodexHooks, cleanupCodexHooks, CODEX_HOOK_MARKER } from './codex-hooks';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);

const HOOKS_JSON = '/mock/home/.codex/hooks.json';
const CONFIG_TOML = '/mock/home/.codex/config.toml';

function mockFiles(files: Record<string, string>): void {
  mockReadFileSync.mockImplementation((p: any) => {
    const content = files[String(p)];
    if (content !== undefined) return content;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureCodexHooksFeatureFlag (via installCodexHooks)', () => {
  it('creates config.toml with feature flag when file does not exist', () => {
    mockFiles({}); // both files missing
    installCodexHooks();

    // First writeFileSync call is config.toml, second is hooks.json
    const tomlCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_TOML);
    expect(tomlCall).toBeDefined();
    expect(String(tomlCall![1])).toContain('[features]');
    expect(String(tomlCall![1])).toContain('codex_hooks = true');
  });

  it('appends [features] section when config.toml exists without it', () => {
    mockFiles({
      [CONFIG_TOML]: 'model = "o3"\n',
    });
    installCodexHooks();

    const tomlCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_TOML);
    const content = String(tomlCall![1]);
    expect(content).toContain('model = "o3"');
    expect(content).toContain('[features]');
    expect(content).toContain('codex_hooks = true');
  });

  it('flips codex_hooks = false to true', () => {
    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = false\n',
    });
    installCodexHooks();

    const tomlCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_TOML);
    const content = String(tomlCall![1]);
    expect(content).toContain('codex_hooks = true');
    expect(content).not.toContain('codex_hooks = false');
  });

  it('inserts key when [features] section exists without codex_hooks', () => {
    mockFiles({
      [CONFIG_TOML]: '[features]\nother_flag = true\n',
    });
    installCodexHooks();

    const tomlCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === CONFIG_TOML);
    const content = String(tomlCall![1]);
    expect(content).toContain('codex_hooks = true');
    expect(content).toContain('other_flag = true');
  });

  it('does not rewrite when already enabled', () => {
    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
    });
    installCodexHooks();

    // config.toml should NOT be written (only hooks.json)
    const tomlCalls = mockWriteFileSync.mock.calls.filter(c => String(c[0]) === CONFIG_TOML);
    expect(tomlCalls).toHaveLength(0);
  });
});

describe('installCodexHooks', () => {
  beforeEach(() => {
    // Provide config.toml with flag already set so we only test hooks.json
    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
    });
  });

  it('creates hooks.json with all 5 events on fresh install', () => {
    installCodexHooks();

    const hooksCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    expect(hooksCall).toBeDefined();
    const written = JSON.parse(String(hooksCall![1]));
    const hooks = written.hooks;

    expect(hooks.SessionStart).toBeDefined();
    expect(hooks.UserPromptSubmit).toBeDefined();
    expect(hooks.PostToolUse).toBeDefined();
    expect(hooks.Stop).toBeDefined();
    expect(hooks.PreToolUse).toBeDefined();
  });

  it('writes correct status values for each event', () => {
    installCodexHooks();

    const hooksCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const hooks = JSON.parse(String(hooksCall![1])).hooks;

    // Check status commands contain correct event:status
    const getStatusCmd = (event: string) =>
      hooks[event].find((m: any) => m.hooks.some((h: any) => h.command.includes('.status')))
        ?.hooks.find((h: any) => h.command.includes('.status'))?.command;

    expect(getStatusCmd('SessionStart')).toContain('SessionStart:waiting');
    expect(getStatusCmd('UserPromptSubmit')).toContain('UserPromptSubmit:working');
    expect(getStatusCmd('PostToolUse')).toContain('PostToolUse:working');
    expect(getStatusCmd('Stop')).toContain('Stop:completed');
  });

  it('includes session ID capture on SessionStart and UserPromptSubmit only', () => {
    installCodexHooks();

    const hooksCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const hooks = JSON.parse(String(hooksCall![1])).hooks;

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
    installCodexHooks();

    const hooksCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const hooks = JSON.parse(String(hooksCall![1])).hooks;

    for (const [, matchers] of Object.entries(hooks) as [string, any[]][]) {
      for (const matcher of matchers) {
        for (const h of matcher.hooks) {
          expect(h.command).toContain(CODEX_HOOK_MARKER);
        }
      }
    }
  });

  it('all hook commands reference $VIBEYARD_SESSION_ID', () => {
    installCodexHooks();

    const hooksCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const hooks = JSON.parse(String(hooksCall![1])).hooks;

    for (const [, matchers] of Object.entries(hooks) as [string, any[]][]) {
      for (const matcher of matchers) {
        for (const h of matcher.hooks) {
          expect(h.command).toContain('VIBEYARD_SESSION_ID');
        }
      }
    }
  });

  it('preserves existing user hooks', () => {
    const existingHooks = {
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{ type: 'command', command: 'echo user-hook' }],
        }],
      },
    };

    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
      [HOOKS_JSON]: JSON.stringify(existingHooks),
    });

    installCodexHooks();

    const hooksCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const hooks = JSON.parse(String(hooksCall![1])).hooks;

    // User hook preserved
    const userMatcher = hooks.SessionStart.find(
      (m: any) => m.hooks.some((h: any) => h.command === 'echo user-hook')
    );
    expect(userMatcher).toBeDefined();

    // Vibeyard hooks also present
    const vibeyardMatcher = hooks.SessionStart.find(
      (m: any) => m.hooks.some((h: any) => h.command.includes(CODEX_HOOK_MARKER))
    );
    expect(vibeyardMatcher).toBeDefined();
  });

  it('is idempotent — no duplicate hooks on second run', () => {
    // First run
    installCodexHooks();
    const firstCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const firstOutput = String(firstCall![1]);

    // Setup the written output as the file content for second run
    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
      [HOOKS_JSON]: firstOutput,
    });
    mockWriteFileSync.mockClear();

    // Second run
    installCodexHooks();
    const secondCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const secondOutput = JSON.parse(String(secondCall![1]));
    const firstParsed = JSON.parse(firstOutput);

    // Same number of matcher groups per event
    for (const event of ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'Stop', 'PreToolUse']) {
      expect(secondOutput.hooks[event]?.length).toBe(firstParsed.hooks[event]?.length);
    }
  });

  it('preserves non-hooks keys in hooks.json', () => {
    const existing = {
      version: '1.0',
      hooks: {},
    };

    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
      [HOOKS_JSON]: JSON.stringify(existing),
    });

    installCodexHooks();

    const hooksCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const written = JSON.parse(String(hooksCall![1]));
    expect(written.version).toBe('1.0');
  });
});

describe('validateCodexHooks', () => {
  it('returns complete when feature flag and all hooks are installed', () => {
    // Install first, then validate with written output
    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
    });
    installCodexHooks();

    const hooksCall = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const hooksContent = String(hooksCall![1]);

    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
      [HOOKS_JSON]: hooksContent,
    });

    const result = validateCodexHooks();
    expect(result.statusLine).toBe('vibeyard');
    expect(result.hooks).toBe('complete');
    expect(result.hookDetails.SessionStart).toBe(true);
    expect(result.hookDetails.UserPromptSubmit).toBe(true);
    expect(result.hookDetails.PostToolUse).toBe(true);
    expect(result.hookDetails.Stop).toBe(true);
  });

  it('returns missing when feature flag is not set', () => {
    mockFiles({
      [CONFIG_TOML]: 'model = "o3"\n',
    });

    const result = validateCodexHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns missing when config.toml does not exist', () => {
    mockFiles({});

    const result = validateCodexHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns missing when hooks.json does not exist but flag is set', () => {
    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
    });

    const result = validateCodexHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns partial when some hooks are missing', () => {
    const partial = {
      hooks: {
        SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: `echo test ${CODEX_HOOK_MARKER}` }] }],
        UserPromptSubmit: [{ matcher: '', hooks: [{ type: 'command', command: `echo test ${CODEX_HOOK_MARKER}` }] }],
      },
    };

    mockFiles({
      [CONFIG_TOML]: '[features]\ncodex_hooks = true\n',
      [HOOKS_JSON]: JSON.stringify(partial),
    });

    const result = validateCodexHooks();
    expect(result.hooks).toBe('partial');
    expect(result.hookDetails.SessionStart).toBe(true);
    expect(result.hookDetails.UserPromptSubmit).toBe(true);
    expect(result.hookDetails.PostToolUse).toBe(false);
    expect(result.hookDetails.Stop).toBe(false);
  });
});

describe('cleanupCodexHooks', () => {
  it('removes vibeyard hooks and preserves user hooks', () => {
    const existing = {
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [{ type: 'command', command: 'echo user-hook' }] },
          { matcher: '', hooks: [{ type: 'command', command: `echo status ${CODEX_HOOK_MARKER}` }] },
        ],
      },
    };

    mockFiles({ [HOOKS_JSON]: JSON.stringify(existing) });
    cleanupCodexHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const written = JSON.parse(String(call![1]));

    expect(written.hooks.SessionStart).toHaveLength(1);
    expect(written.hooks.SessionStart[0].hooks[0].command).toBe('echo user-hook');
  });

  it('removes hooks key when all hooks are vibeyard hooks', () => {
    const existing = {
      version: '1.0',
      hooks: {
        SessionStart: [
          { matcher: '', hooks: [{ type: 'command', command: `echo ${CODEX_HOOK_MARKER}` }] },
        ],
      },
    };

    mockFiles({ [HOOKS_JSON]: JSON.stringify(existing) });
    cleanupCodexHooks();

    const call = mockWriteFileSync.mock.calls.find(c => String(c[0]) === HOOKS_JSON);
    const written = JSON.parse(String(call![1]));
    expect(written.hooks).toBeUndefined();
    expect(written.version).toBe('1.0');
  });

  it('handles missing hooks.json gracefully', () => {
    mockFiles({});
    expect(() => cleanupCodexHooks()).not.toThrow();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
