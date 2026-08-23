import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

const mockExecSync = vi.fn();
vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('os', () => ({
  homedir: () => '/home/test',
  tmpdir: () => '/tmp',
}));

vi.mock('fs', () => ({
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// hook-status (source of SCRIPT_DIR) imports electron; keep it loadable.
vi.mock('electron', () => ({ BrowserWindow: {} }));

// pty-manager pulls in node-pty; stub the one symbol claude-version uses.
vi.mock('../pty-manager', () => ({
  getFullPath: () => '/usr/bin:/bin',
}));

import * as fs from 'fs';
import { getClaudeVersion, _resetVersionCache } from './claude-version';

const mockStatSync = vi.mocked(fs.statSync);
const mockReadFileSync = vi.mocked(fs.readFileSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);

const BINARY = '/usr/local/bin/claude';
// SCRIPT_DIR resolves to /home/test/.vibeyard/run under the os mock above.
const CACHE_FILE = path.join('/home/test', '.vibeyard', 'run', 'claude-version-cache.json');

beforeEach(() => {
  vi.clearAllMocks();
  _resetVersionCache();
  mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockExecSync.mockImplementation(() => { throw new Error('not found'); });
});

describe('getClaudeVersion', () => {
  it('detects the version from the binary on first use and persists it', () => {
    mockStatSync.mockReturnValue({ mtimeMs: 1000 } as never);
    mockExecSync.mockReturnValue('2.1.89\n');

    expect(getClaudeVersion(BINARY)).toBe('2.1.89');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      CACHE_FILE,
      expect.stringContaining('"2.1.89"'),
    );
  });

  it('serves a warm launch from the persisted cache without spawning', () => {
    mockStatSync.mockReturnValue({ mtimeMs: 1000 } as never);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ binaryPath: BINARY, mtimeMs: 1000, version: '2.1.89' }),
    );

    expect(getClaudeVersion(BINARY)).toBe('2.1.89');
    expect(mockExecSync).not.toHaveBeenCalled();
  });

  it('re-detects when the binary mtime changed (updated binary)', () => {
    mockStatSync.mockReturnValue({ mtimeMs: 2000 } as never);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ binaryPath: BINARY, mtimeMs: 1000, version: '2.1.89' }),
    );
    mockExecSync.mockReturnValue('2.2.0\n');

    expect(getClaudeVersion(BINARY)).toBe('2.2.0');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      CACHE_FILE,
      expect.stringContaining('"2.2.0"'),
    );
  });

  it('serves a second in-process call from memory without a second spawn', () => {
    mockStatSync.mockReturnValue({ mtimeMs: 1000 } as never);
    mockExecSync.mockReturnValue('2.1.89\n');

    expect(getClaudeVersion(BINARY)).toBe('2.1.89');
    expect(getClaudeVersion(BINARY)).toBe('2.1.89');
    expect(mockExecSync).toHaveBeenCalledTimes(1);
  });

  it('returns null and does not persist when the binary is missing', () => {
    // statSync throws (binary absent); execSync also fails.
    expect(getClaudeVersion(BINARY)).toBeNull();
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});
