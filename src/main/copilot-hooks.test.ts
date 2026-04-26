import { vi } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
  tmpdir: () => '/tmp',
}));

vi.mock('./hook-commands', () => ({
  installHookScripts: vi.fn(),
  installEventScript: vi.fn(),
}));

vi.mock('./platform', () => ({
  isWin: false,
  pythonBin: '/usr/bin/python3',
}));

import * as fs from 'fs';
import * as path from 'path';
import { installEventScript } from './hook-commands';
import {
  installCopilotHooks,
  validateCopilotHooks,
  cleanupCopilotHooks,
  COPILOT_HOOK_MARKER,
  _resetForTesting,
} from './copilot-hooks';

const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);
const mockInstallEventScript = vi.mocked(installEventScript);

const n = (p: string) => p.replace(/\\/g, '/');

const PROJECT = '/mock/project';
const HOOK_FILE = path.join(PROJECT, '.github', 'hooks', 'vibeyard-copilot-hooks.json');

function mockFiles(rawFiles: Record<string, string>): void {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFiles)) files[n(k)] = v;
  mockReadFileSync.mockImplementation((p: any) => {
    const content = files[n(String(p))];
    if (content !== undefined) return content;
    throw new Error('ENOENT');
  });
}

function findWrite(target: string): [any, any] | undefined {
  return mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(target)) as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTesting();
});

describe('installCopilotHooks', () => {
  it('writes the hook file under <projectPath>/.github/hooks/', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);

    const call = findWrite(HOOK_FILE);
    expect(call).toBeDefined();
  });

  it('is a no-op when no projectPath has ever been provided', () => {
    mockFiles({});
    installCopilotHooks();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('falls back to lastProjectPath when projectPath is omitted', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    mockWriteFileSync.mockClear();

    installCopilotHooks();
    expect(findWrite(HOOK_FILE)).toBeDefined();
  });

  it('writes version:1 at the top level', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    const written = JSON.parse(String(findWrite(HOOK_FILE)![1]));
    expect(written.version).toBe(1);
  });

  it('installs all seven Copilot events', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    const { hooks } = JSON.parse(String(findWrite(HOOK_FILE)![1]));
    expect(hooks.sessionStart).toBeDefined();
    expect(hooks.userPromptSubmitted).toBeDefined();
    expect(hooks.preToolUse).toBeDefined();
    expect(hooks.postToolUse).toBeDefined();
    expect(hooks.errorOccurred).toBeDefined();
    expect(hooks.agentStop).toBeDefined();
    expect(hooks.sessionEnd).toBeDefined();
  });

  it('each entry has type=command plus bash and powershell fields', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    const { hooks } = JSON.parse(String(findWrite(HOOK_FILE)![1]));
    for (const [, entries] of Object.entries(hooks) as [string, any[]][]) {
      for (const h of entries) {
        expect(h.type).toBe('command');
        expect(typeof h.bash).toBe('string');
        expect(typeof h.powershell).toBe('string');
        expect(h.command).toBeUndefined();
      }
    }
  });

  it('every entry contains the vibeyard hook marker', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    const { hooks } = JSON.parse(String(findWrite(HOOK_FILE)![1]));
    for (const [, entries] of Object.entries(hooks) as [string, any[]][]) {
      for (const h of entries) {
        expect(h.bash).toContain(COPILOT_HOOK_MARKER);
        expect(h.powershell).toContain(COPILOT_HOOK_MARKER);
      }
    }
  });

  it('passes event, inspector type, status, env var, and status dir as argv to the Python script', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    const { hooks } = JSON.parse(String(findWrite(HOOK_FILE)![1]));

    const start = hooks.sessionStart[0].bash as string;
    expect(start).toContain('"sessionStart"');
    expect(start).toContain('"session_start"');
    expect(start).toContain('"waiting"');
    expect(start).toContain('"VIBEYARD_SESSION_ID"');

    const submit = hooks.userPromptSubmitted[0].bash as string;
    expect(submit).toContain('"userPromptSubmitted"');
    expect(submit).toContain('"user_prompt"');
    expect(submit).toContain('"working"');

    const err = hooks.errorOccurred[0].bash as string;
    expect(err).toContain('"errorOccurred"');
    expect(err).toContain('"tool_failure"');

    const stop = hooks.agentStop[0].bash as string;
    expect(stop).toContain('"agentStop"');
    expect(stop).toContain('"stop"');
    expect(stop).toContain('"completed"');

    const end = hooks.sessionEnd[0].bash as string;
    expect(end).toContain('"sessionEnd"');
    expect(end).toContain('"session_end"');
    expect(end).toContain('"completed"');
  });

  it('installs an event capture script that writes the Copilot session ID to .sessionid when present', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);

    const eventScriptCall = mockInstallEventScript.mock.calls.find(([name]) => name === 'copilot_event_capture.py');
    expect(eventScriptCall).toBeDefined();
    const scriptBody = String(eventScriptCall![1]);
    expect(scriptBody).toContain(".sessionid");
    expect(scriptBody).toContain("sessionId");
    expect(scriptBody).toContain("session_id");
    expect(scriptBody).toContain("d.get('input')");
    expect(scriptBody).toContain("d.get('data')");
  });

  it('skips the write when existing content is byte-identical', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    const first = String(findWrite(HOOK_FILE)![1]);

    mockFiles({ [HOOK_FILE]: first });
    mockWriteFileSync.mockClear();
    installCopilotHooks(PROJECT);

    expect(findWrite(HOOK_FILE)).toBeUndefined();
  });

  it('rewrites the file when existing content differs', () => {
    mockFiles({ [HOOK_FILE]: '{"version":1,"hooks":{}}' });
    installCopilotHooks(PROJECT);
    expect(findWrite(HOOK_FILE)).toBeDefined();
  });
});

describe('validateCopilotHooks', () => {
  it('returns complete after a fresh install', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    const written = String(findWrite(HOOK_FILE)![1]);
    mockFiles({ [HOOK_FILE]: written });

    const result = validateCopilotHooks(PROJECT);
    expect(result.hooks).toBe('complete');
    expect(result.hookDetails.sessionStart).toBe(true);
    expect(result.hookDetails.userPromptSubmitted).toBe(true);
    expect(result.hookDetails.preToolUse).toBe(true);
    expect(result.hookDetails.postToolUse).toBe(true);
    expect(result.hookDetails.errorOccurred).toBe(true);
    expect(result.hookDetails.agentStop).toBe(true);
    expect(result.hookDetails.sessionEnd).toBe(true);
  });

  it('returns missing when hook file does not exist', () => {
    mockFiles({});
    const result = validateCopilotHooks(PROJECT);
    expect(result.hooks).toBe('missing');
  });

  it('returns missing when no projectPath is known', () => {
    mockFiles({});
    const result = validateCopilotHooks();
    expect(result.hooks).toBe('missing');
  });

  it('returns partial when only some events have marker-bearing hooks', () => {
    const partial = {
      version: 1,
      hooks: {
        sessionStart:        [{ type: 'command', bash: `echo ${COPILOT_HOOK_MARKER}`, powershell: '' }],
        userPromptSubmitted: [{ type: 'command', bash: `echo ${COPILOT_HOOK_MARKER}`, powershell: '' }],
      },
    };
    mockFiles({ [HOOK_FILE]: JSON.stringify(partial) });
    const result = validateCopilotHooks(PROJECT);
    expect(result.hooks).toBe('partial');
    expect(result.hookDetails.sessionStart).toBe(true);
    expect(result.hookDetails.postToolUse).toBe(false);
  });

  it('detects the marker in either bash or powershell field', () => {
    const config = {
      version: 1,
      hooks: {
        sessionStart:        [{ type: 'command', bash: `x ${COPILOT_HOOK_MARKER}` }],
        userPromptSubmitted: [{ type: 'command', powershell: `x ${COPILOT_HOOK_MARKER}` }],
        preToolUse:          [{ type: 'command', bash: `x ${COPILOT_HOOK_MARKER}` }],
        postToolUse:         [{ type: 'command', bash: `x ${COPILOT_HOOK_MARKER}` }],
        errorOccurred:       [{ type: 'command', bash: `x ${COPILOT_HOOK_MARKER}` }],
        agentStop:           [{ type: 'command', bash: `x ${COPILOT_HOOK_MARKER}` }],
        sessionEnd:          [{ type: 'command', bash: `x ${COPILOT_HOOK_MARKER}` }],
      },
    };
    mockFiles({ [HOOK_FILE]: JSON.stringify(config) });
    expect(validateCopilotHooks(PROJECT).hooks).toBe('complete');
  });
});

describe('cleanupCopilotHooks', () => {
  it('deletes the hook file', () => {
    mockFiles({});
    installCopilotHooks(PROJECT);
    cleanupCopilotHooks(PROJECT);
    expect(mockUnlinkSync).toHaveBeenCalledWith(HOOK_FILE);
  });

  it('is a no-op when no projectPath is known', () => {
    mockFiles({});
    cleanupCopilotHooks();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('swallows ENOENT when file is already gone', () => {
    mockUnlinkSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFiles({});
    installCopilotHooks(PROJECT);
    expect(() => cleanupCopilotHooks(PROJECT)).not.toThrow();
  });
});
