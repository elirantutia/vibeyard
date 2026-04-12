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

import * as fs from 'fs';
import * as path from 'path';
import {
  installOpenCodeHooks,
  validateOpenCodeHooks,
  cleanupOpenCodeHooks,
  OPENCODE_HOOK_MARKER,
  SESSION_ID_VAR,
  _resetForTesting,
} from './opencode-hooks';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockUnlinkSync = vi.mocked(fs.unlinkSync);

const n = (p: string) => p.replace(/\\/g, '/');

const PLUGIN_PATH = path.join('/project', '.opencode', 'plugins', 'vibeyard-status.js');

function mockFiles(rawFiles: Record<string, string>): void {
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawFiles)) files[n(k)] = v;
  mockExistsSync.mockImplementation((p: any) => n(String(p)) in files);
  mockReadFileSync.mockImplementation((p: any) => {
    const content = files[n(String(p))];
    if (content !== undefined) return content;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTesting();
});

describe('installOpenCodeHooks', () => {
  it('creates plugin file with vibeyard marker', () => {
    mockFiles({});
    installOpenCodeHooks('/project');

    const writeCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(PLUGIN_PATH));
    expect(writeCall).toBeDefined();
    const content = String(writeCall![1]);
    expect(content).toContain(OPENCODE_HOOK_MARKER);
  });

  it('creates plugin file containing session ID var', () => {
    mockFiles({});
    installOpenCodeHooks('/project');

    const writeCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(PLUGIN_PATH));
    expect(String(writeCall![1])).toContain(SESSION_ID_VAR);
  });

  it('plugin handles all expected events', () => {
    mockFiles({});
    installOpenCodeHooks('/project');

    const writeCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(PLUGIN_PATH));
    const content = String(writeCall![1]);
    expect(content).toContain('session.created');
    expect(content).toContain('session.idle');
    expect(content).toContain('tool.execute.before');
    expect(content).toContain('tool.execute.after');
  });

  it('creates plugin directory if needed', () => {
    mockFiles({});
    installOpenCodeHooks('/project');

    expect(mockMkdirSync).toHaveBeenCalledWith(
      path.dirname(PLUGIN_PATH),
      { recursive: true },
    );
  });

  it('skips write when content is byte-identical', () => {
    mockFiles({});
    installOpenCodeHooks('/project');

    const firstCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(PLUGIN_PATH));
    const writtenContent = String(firstCall![1]);

    mockFiles({ [PLUGIN_PATH]: writtenContent });
    mockWriteFileSync.mockClear();

    installOpenCodeHooks('/project');
    const secondCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(PLUGIN_PATH));
    expect(secondCall).toBeUndefined();
  });

  it('remembers last project path for subsequent calls without argument', () => {
    mockFiles({});
    installOpenCodeHooks('/project');
    mockWriteFileSync.mockClear();

    // Install again without path — should use remembered path
    mockFiles({});
    installOpenCodeHooks();

    const writeCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(PLUGIN_PATH));
    expect(writeCall).toBeDefined();
  });

  it('is a no-op when called without path and no prior install', () => {
    mockFiles({});
    installOpenCodeHooks(); // no path, no prior project
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('adds plugin path to .gitignore when .gitignore does not exist', () => {
    mockFiles({});
    installOpenCodeHooks('/project');

    const gitignorePath = n(path.join('/project', '.gitignore'));
    const gitignoreWrite = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === gitignorePath);
    expect(gitignoreWrite).toBeDefined();
    expect(String(gitignoreWrite![1])).toContain('.opencode/plugins/vibeyard-status.js');
  });

  it('appends plugin path to existing .gitignore that does not contain it', () => {
    const gitignorePath = path.join('/project', '.gitignore');
    mockFiles({ [gitignorePath]: 'node_modules\ndist\n' });
    installOpenCodeHooks('/project');

    const gitignoreWrite = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(gitignorePath));
    expect(gitignoreWrite).toBeDefined();
    expect(String(gitignoreWrite![1])).toContain('.opencode/plugins/vibeyard-status.js');
  });

  it('does not modify .gitignore when entry already present', () => {
    const gitignorePath = path.join('/project', '.gitignore');
    mockFiles({ [gitignorePath]: 'node_modules\n.opencode/plugins/vibeyard-status.js\n' });
    installOpenCodeHooks('/project');

    const gitignoreWrite = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(gitignorePath));
    expect(gitignoreWrite).toBeUndefined();
  });
});

describe('validateOpenCodeHooks', () => {
  it('returns complete when plugin file exists with all events', () => {
    mockFiles({});
    installOpenCodeHooks('/project');
    const writeCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(PLUGIN_PATH));
    const content = String(writeCall![1]);

    mockFiles({ [PLUGIN_PATH]: content });
    const result = validateOpenCodeHooks('/project');

    expect(result.statusLine).toBe('vibeyard');
    expect(result.hooks).toBe('complete');
    expect(result.hookDetails['session.created']).toBe(true);
    expect(result.hookDetails['session.idle']).toBe(true);
    expect(result.hookDetails['tool.execute.before']).toBe(true);
    expect(result.hookDetails['tool.execute.after']).toBe(true);
  });

  it('returns missing when plugin file does not exist', () => {
    mockFiles({});
    const result = validateOpenCodeHooks('/project');
    expect(result.hooks).toBe('missing');
  });

  it('returns missing when plugin file lacks vibeyard marker', () => {
    mockFiles({ [PLUGIN_PATH]: 'export const MyPlugin = async () => ({});' });
    const result = validateOpenCodeHooks('/project');
    expect(result.hooks).toBe('missing');
  });

  it('returns partial when only some events are present', () => {
    const partial = `${OPENCODE_HOOK_MARKER}\nconst SID = '${SESSION_ID_VAR}';\n// only session.created\nsession.created\n`;
    mockFiles({ [PLUGIN_PATH]: partial });
    const result = validateOpenCodeHooks('/project');
    expect(result.hooks).toBe('partial');
    expect(result.hookDetails['session.created']).toBe(true);
    expect(result.hookDetails['session.idle']).toBe(false);
  });

  it('returns missing when no project path and no prior install', () => {
    const result = validateOpenCodeHooks();
    expect(result.hooks).toBe('missing');
  });

  it('uses last project path when called without argument after install', () => {
    mockFiles({});
    installOpenCodeHooks('/project');
    const writeCall = mockWriteFileSync.mock.calls.find(c => n(String(c[0])) === n(PLUGIN_PATH));
    const content = String(writeCall![1]);

    mockFiles({ [PLUGIN_PATH]: content });
    const result = validateOpenCodeHooks(); // no path arg
    expect(result.hooks).toBe('complete');
  });
});

describe('cleanupOpenCodeHooks', () => {
  it('removes the plugin file', () => {
    cleanupOpenCodeHooks('/project');
    expect(mockUnlinkSync).toHaveBeenCalledWith(PLUGIN_PATH);
  });

  it('does not throw when plugin file is already gone', () => {
    mockUnlinkSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => cleanupOpenCodeHooks('/project')).not.toThrow();
  });

  it('is a no-op when called without path and no prior install', () => {
    cleanupOpenCodeHooks();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});
