import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

const platform = vi.hoisted(() => ({ isWin: false, isMac: false, pathSep: ':' }));
vi.mock('./platform', () => platform);

const mockGetFullPath = vi.hoisted(() => vi.fn(() => ''));
vi.mock('./shell-path', () => ({ getFullPath: mockGetFullPath }));

const files = vi.hoisted(() => new Map<string, { isFile: boolean; exec: boolean }>());
vi.mock('fs', () => ({
  constants: { X_OK: 1 },
  statSync: (p: string) => {
    const f = files.get(p);
    if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { isFile: () => f.isFile };
  },
  accessSync: (p: string) => {
    if (!files.get(p)?.exec) throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
  },
}));

const mockExecFileSync = vi.hoisted(() => vi.fn());
const mockExecSync = vi.hoisted(() => vi.fn());
vi.mock('child_process', () => ({ execFileSync: mockExecFileSync, execSync: mockExecSync }));

import { getPythonBin, getPythonCmd, isPythonUsable, _resetForTesting } from './python-bin';

const STUB = '/usr/bin/python3';
const exe = (dir: string) => {
  const p = path.join(dir, 'python3');
  files.set(p, { isFile: true, exec: true });
  return p;
};
const noCommandLineTools = () =>
  mockExecFileSync.mockImplementation(() => { throw new Error('xcode-select: no developer tools'); });

beforeEach(() => {
  files.clear();
  mockGetFullPath.mockReset().mockReturnValue('');
  mockExecFileSync.mockReset();
  mockExecSync.mockReset();
  Object.assign(platform, { isWin: false, isMac: false, pathSep: ':' });
  delete process.env.VIRTUAL_ENV;
  delete process.env.CONDA_PREFIX;
  _resetForTesting();
});

// POSIX-only: these drive POSIX PATH strings through the native path module,
// which a Windows runner would rewrite (real Windows always uses bare `python`).
describe.skipIf(path.sep === '\\')('POSIX resolution', () => {
  describe('getPythonBin', () => {
    it('returns the first executable python3 in PATH order, unresolved', () => {
      exe('/run/current-system/sw/bin');
      exe('/usr/bin');
      mockGetFullPath.mockReturnValue('/nix/empty:/run/current-system/sw/bin:/usr/bin');
      expect(getPythonBin()).toBe('/run/current-system/sw/bin/python3');
    });

    it('skips non-executable files, directories, and relative/empty entries', () => {
      files.set('/a/python3', { isFile: true, exec: false });
      files.set('/b/python3', { isFile: false, exec: true });
      exe('rel');
      exe('/c');
      mockGetFullPath.mockReturnValue('/a::/b:rel:/c');
      expect(getPythonBin()).toBe('/c/python3');
    });

    it('falls back to /usr/bin/python3 when PATH has no python3', () => {
      mockGetFullPath.mockReturnValue('/nowhere');
      expect(getPythonBin()).toBe(STUB);
    });

    it('resolves once per process', () => {
      mockGetFullPath.mockReturnValue('/nowhere');
      getPythonBin();
      getPythonBin();
      expect(mockGetFullPath).toHaveBeenCalledTimes(1);
    });

    it('prefers a stable interpreter over shims, store paths and an active venv', () => {
      exe('/home/u/.pyenv/shims');
      exe('/nix/store/abc-python3/bin');
      exe('/home/u/proj/.venv/bin');
      exe('/usr/local/bin');
      process.env.VIRTUAL_ENV = '/home/u/proj/.venv';
      mockGetFullPath.mockReturnValue(
        '/home/u/.pyenv/shims:/nix/store/abc-python3/bin:/home/u/proj/.venv/bin:/usr/local/bin',
      );
      expect(getPythonBin()).toBe('/usr/local/bin/python3');
    });

    it('still uses a transient interpreter when nothing stable exists', () => {
      exe('/home/u/.pyenv/shims');
      exe('/nix/store/abc-python3/bin');
      mockGetFullPath.mockReturnValue('/home/u/.pyenv/shims:/nix/store/abc-python3/bin');
      expect(getPythonBin()).toBe('/home/u/.pyenv/shims/python3');
    });

    it('on a Mac without the CLT, skips the /usr/bin stub even when it comes first', () => {
      platform.isMac = true;
      noCommandLineTools();
      exe('/usr/bin');
      exe('/opt/homebrew/bin');
      mockGetFullPath.mockReturnValue('/usr/bin:/bin:/opt/homebrew/bin');
      expect(getPythonBin()).toBe('/opt/homebrew/bin/python3');
    });

    it('on a Mac with the CLT, /usr/bin/python3 is a normal candidate', () => {
      platform.isMac = true;
      exe('/usr/bin');
      exe('/opt/homebrew/bin');
      mockGetFullPath.mockReturnValue('/usr/bin:/opt/homebrew/bin');
      expect(getPythonBin()).toBe(STUB);
    });
  });

  describe('getPythonCmd', () => {
    it('leaves a path-safe interpreter bare', () => {
      exe('/home/u/.nix-profile/bin');
      mockGetFullPath.mockReturnValue('/home/u/.nix-profile/bin');
      expect(getPythonCmd()).toBe('/home/u/.nix-profile/bin/python3');
    });

    it('single-quotes paths with shell-special characters', () => {
      exe("/home/o'brien/my py/bin");
      mockGetFullPath.mockReturnValue("/home/o'brien/my py/bin");
      expect(getPythonCmd()).toBe(`'/home/o'\\''brien/my py/bin/python3'`);
    });
  });

  describe('isPythonUsable', () => {
    it('is true for an executable PATH match without running it', () => {
      exe('/opt/homebrew/bin');
      mockGetFullPath.mockReturnValue('/opt/homebrew/bin');
      expect(isPythonUsable()).toBe(true);
      expect(mockExecFileSync).not.toHaveBeenCalled();
    });

    it('is false when the /usr/bin/python3 fallback does not exist (NixOS)', () => {
      expect(isPythonUsable()).toBe(false);
    });

    it('is false on a Mac whose only python3 is the stub, without running it', () => {
      platform.isMac = true;
      noCommandLineTools();
      exe('/usr/bin');
      mockGetFullPath.mockReturnValue('/usr/bin');
      expect(isPythonUsable()).toBe(false);
      expect(mockExecFileSync).toHaveBeenCalledWith('/usr/bin/xcode-select', ['-p'], expect.anything());
      expect(mockExecFileSync).toHaveBeenCalledTimes(1); // CLT probe is cached
    });
  });
});

describe('Windows', () => {
  beforeEach(() => { platform.isWin = true; });

  it('uses bare `python` without searching PATH', () => {
    expect(getPythonBin()).toBe('python');
    expect(mockGetFullPath).not.toHaveBeenCalled();
  });

  it('checks `python --version` through a shell so .bat shims count', () => {
    expect(isPythonUsable()).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith('python --version', expect.anything());
    mockExecSync.mockImplementationOnce(() => { throw new Error('not recognized'); });
    expect(isPythonUsable()).toBe(false);
  });
});
