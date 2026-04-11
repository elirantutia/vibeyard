import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

const mockExecSync = vi.fn();

vi.mock('child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('os', () => ({
  homedir: () => 'C:\\Users\\test',
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => { throw new Error('ENOENT'); }),
}));

// Mock platform as Windows for these tests
vi.mock('../platform', () => ({
  isWin: true,
  pathSep: ';',
  whichCmd: 'where',
}));

// Mock pty-manager to avoid its module-level side effects
vi.mock('../pty-manager', () => ({
  getFullPath: () => 'C:\\Windows\\system32;C:\\Users\\test\\AppData\\Roaming\\npm',
}));

import * as fs from 'fs';
import { resolveBinary, validateBinaryExists } from './resolve-binary';

const mockStatSync = vi.mocked(fs.statSync);

const fileStat = { isFile: () => true } as fs.Stats;

beforeEach(() => {
  vi.clearAllMocks();
  mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockExecSync.mockImplementation(() => { throw new Error('not found'); });
});

describe('resolveBinary (Windows)', () => {
  it('checks expanded candidate dirs including scoop shims', () => {
    const scoopPath = path.join('C:\\Users\\test', 'scoop', 'shims', 'claude.cmd');
    mockStatSync.mockImplementation((p) => {
      if (String(p) === scoopPath) return fileStat;
      throw new Error('ENOENT');
    });

    const cache = { path: null as string | null };
    const result = resolveBinary('claude', cache);

    expect(result).toBe(scoopPath);
    expect(cache.path).toBe(scoopPath);
  });

  it('checks volta bin directory', () => {
    const voltaPath = path.join('C:\\Users\\test', '.volta', 'bin', 'claude.cmd');
    mockStatSync.mockImplementation((p) => {
      if (String(p) === voltaPath) return fileStat;
      throw new Error('ENOENT');
    });

    const cache = { path: null as string | null };
    const result = resolveBinary('claude', cache);

    expect(result).toBe(voltaPath);
  });

  it('checks standalone installer subdirectory', () => {
    const standalonePath = path.join('C:\\Users\\test', 'AppData', 'Local', 'Programs', 'claude', 'claude.cmd');
    mockStatSync.mockImplementation((p) => {
      if (String(p) === standalonePath) return fileStat;
      throw new Error('ENOENT');
    });

    const cache = { path: null as string | null };
    const result = resolveBinary('claude', cache);

    expect(result).toBe(standalonePath);
  });

  it('checks chocolatey bin directory', () => {
    const chocoPath = path.join(process.env.ProgramData || 'C:\\ProgramData', 'chocolatey', 'bin', 'claude.cmd');
    mockStatSync.mockImplementation((p) => {
      if (String(p) === chocoPath) return fileStat;
      throw new Error('ENOENT');
    });

    const cache = { path: null as string | null };
    const result = resolveBinary('claude', cache);

    expect(result).toBe(chocoPath);
  });

  it('falls back to npm prefix -g discovery', () => {
    const customPrefix = 'D:\\custom-npm';
    const customPath = path.join(customPrefix, 'claude.cmd');

    // All static candidates fail, where fails
    mockStatSync.mockImplementation((p) => {
      if (String(p) === customPath) return fileStat;
      throw new Error('ENOENT');
    });
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm prefix')) return `${customPrefix}\n`;
      throw new Error('not found');
    });

    const cache = { path: null as string | null };
    const result = resolveBinary('claude', cache);

    expect(result).toBe(customPath);
  });

  it('returns bare binary name when all methods fail', () => {
    const cache = { path: null as string | null };
    const result = resolveBinary('claude', cache);

    expect(result).toBe('claude');
  });

  it('uses cached path on subsequent calls', () => {
    const cache = { path: 'C:\\cached\\claude.cmd' };
    const result = resolveBinary('claude', cache);

    expect(result).toBe('C:\\cached\\claude.cmd');
    expect(mockStatSync).not.toHaveBeenCalled();
  });
});

describe('validateBinaryExists (Windows)', () => {
  it('returns ok when found in expanded candidate dirs', () => {
    const scoopPath = path.join('C:\\Users\\test', 'scoop', 'shims', 'claude.cmd');
    mockStatSync.mockImplementation((p) => {
      if (String(p) === scoopPath) return fileStat;
      throw new Error('ENOENT');
    });

    expect(validateBinaryExists('claude')).toBe(true);
  });

  it('returns ok when npm prefix -g finds the binary', () => {
    const customPrefix = 'D:\\custom-npm';
    const customPath = path.join(customPrefix, 'claude.cmd');

    mockStatSync.mockImplementation((p) => {
      if (String(p) === customPath) return fileStat;
      throw new Error('ENOENT');
    });
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.startsWith('npm prefix')) return `${customPrefix}\n`;
      throw new Error('not found');
    });

    expect(validateBinaryExists('claude')).toBe(true);
  });

  it('returns false when all methods fail', () => {
    expect(validateBinaryExists('claude')).toBe(false);
  });
});
