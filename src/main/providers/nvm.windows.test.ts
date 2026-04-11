import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('os', () => ({
  homedir: () => 'C:\\Users\\test',
}));

vi.mock('../platform', () => ({
  isWin: true,
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

beforeEach(() => {
  mockFileExists.mockReset().mockReturnValue(true);
  mockDirExists.mockReset().mockReturnValue(true);
  mockReadDirSafe.mockReset().mockReturnValue(['v24.11.1']);
  mockReadFileSafe.mockReset().mockReturnValue('v24.11.1');
});

describe('nvm helpers (Windows)', () => {
  it('findBinaryInNvm returns null even when the filesystem would match', () => {
    expect(findBinaryInNvm('claude')).toBeNull();
  });

  it('nvmDefaultNodeBinDir returns null even when the filesystem would match', () => {
    expect(nvmDefaultNodeBinDir()).toBeNull();
  });

  it('does not touch the filesystem on Windows', () => {
    findBinaryInNvm('claude');
    nvmDefaultNodeBinDir();
    expect(mockDirExists).not.toHaveBeenCalled();
    expect(mockFileExists).not.toHaveBeenCalled();
    expect(mockReadDirSafe).not.toHaveBeenCalled();
    expect(mockReadFileSafe).not.toHaveBeenCalled();
  });
});
