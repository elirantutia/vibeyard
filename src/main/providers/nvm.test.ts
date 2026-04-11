import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';

vi.mock('os', () => ({
  homedir: () => '/Users/test',
}));

vi.mock('../platform', () => ({
  isWin: false,
}));

const mockFileExists = vi.fn();
const mockDirExists = vi.fn();
const mockReadDirSafe = vi.fn();
const mockReadFileSafe = vi.fn();

vi.mock('../fs-utils', () => ({
  fileExists: (p: string) => mockFileExists(p),
  dirExists: (p: string) => mockDirExists(p),
  readDirSafe: (p: string) => mockReadDirSafe(p),
  readFileSafe: (p: string) => mockReadFileSafe(p),
}));

import { findBinaryInNvm, nvmDefaultNodeBinDir } from './nvm';

const defaultNvmDir = '/Users/test/.nvm';
const defaultVersionsDir = path.join(defaultNvmDir, 'versions', 'node');

beforeEach(() => {
  delete process.env.NVM_DIR;
  mockFileExists.mockReset().mockReturnValue(false);
  mockDirExists.mockReset().mockReturnValue(false);
  mockReadDirSafe.mockReset().mockReturnValue([]);
  mockReadFileSafe.mockReset().mockReturnValue(null);
});

afterEach(() => {
  delete process.env.NVM_DIR;
});

describe('findBinaryInNvm', () => {
  it('returns null when nvm versions dir does not exist', () => {
    mockDirExists.mockReturnValue(false);
    expect(findBinaryInNvm('claude')).toBeNull();
  });

  it('finds binary under the default version when alias/default is set', () => {
    const version = 'v24.11.1';
    const expected = path.join(defaultVersionsDir, version, 'bin', 'claude');
    mockDirExists.mockImplementation((p) => p === defaultVersionsDir);
    mockReadFileSafe.mockImplementation((p) =>
      p === path.join(defaultNvmDir, 'alias', 'default') ? `${version}\n` : null,
    );
    mockFileExists.mockImplementation((p) => p === expected);

    expect(findBinaryInNvm('claude')).toBe(expected);
  });

  it('iterates versions when alias/default is missing', () => {
    const expected = path.join(defaultVersionsDir, 'v22.0.0', 'bin', 'claude');
    mockDirExists.mockImplementation((p) => p === defaultVersionsDir);
    mockReadFileSafe.mockReturnValue(null);
    mockReadDirSafe.mockImplementation((p) =>
      p === defaultVersionsDir ? ['v20.0.0', 'v22.0.0', 'v24.0.0'] : [],
    );
    mockFileExists.mockImplementation((p) => p === expected);

    expect(findBinaryInNvm('claude')).toBe(expected);
  });

  it('falls through to iteration when alias/default names a version without the binary', () => {
    const fallbackVersion = 'v22.0.0';
    const expected = path.join(defaultVersionsDir, fallbackVersion, 'bin', 'claude');
    mockDirExists.mockImplementation((p) => p === defaultVersionsDir);
    mockReadFileSafe.mockImplementation((p) =>
      p === path.join(defaultNvmDir, 'alias', 'default') ? 'v24.11.1\n' : null,
    );
    mockReadDirSafe.mockImplementation((p) =>
      p === defaultVersionsDir ? ['v24.11.1', fallbackVersion] : [],
    );
    mockFileExists.mockImplementation((p) => p === expected);

    expect(findBinaryInNvm('claude')).toBe(expected);
  });

  it('respects the NVM_DIR env override', () => {
    const customDir = '/opt/nvm';
    const customVersionsDir = path.join(customDir, 'versions', 'node');
    const expected = path.join(customVersionsDir, 'v24.11.1', 'bin', 'claude');
    process.env.NVM_DIR = customDir;
    mockDirExists.mockImplementation((p) => p === customVersionsDir);
    mockReadFileSafe.mockImplementation((p) =>
      p === path.join(customDir, 'alias', 'default') ? 'v24.11.1' : null,
    );
    mockFileExists.mockImplementation((p) => p === expected);

    expect(findBinaryInNvm('claude')).toBe(expected);
  });

  it('returns null when no version contains the binary', () => {
    mockDirExists.mockImplementation((p) => p === defaultVersionsDir);
    mockReadDirSafe.mockImplementation((p) =>
      p === defaultVersionsDir ? ['v22.0.0'] : [],
    );
    mockFileExists.mockReturnValue(false);

    expect(findBinaryInNvm('claude')).toBeNull();
  });
});

describe('nvmDefaultNodeBinDir', () => {
  it('returns null when nvm versions dir does not exist', () => {
    expect(nvmDefaultNodeBinDir()).toBeNull();
  });

  it('prefers the default version bin dir', () => {
    const version = 'v24.11.1';
    const expected = path.join(defaultVersionsDir, version, 'bin');
    mockDirExists.mockImplementation((p) => p === defaultVersionsDir || p === expected);
    mockReadFileSafe.mockImplementation((p) =>
      p === path.join(defaultNvmDir, 'alias', 'default') ? version : null,
    );

    expect(nvmDefaultNodeBinDir()).toBe(expected);
  });

  it('falls back to the first version dir when no default is set', () => {
    const expected = path.join(defaultVersionsDir, 'v22.0.0', 'bin');
    mockDirExists.mockImplementation((p) => p === defaultVersionsDir || p === expected);
    mockReadFileSafe.mockReturnValue(null);
    mockReadDirSafe.mockImplementation((p) =>
      p === defaultVersionsDir ? ['v22.0.0', 'v24.0.0'] : [],
    );

    expect(nvmDefaultNodeBinDir()).toBe(expected);
  });
});
