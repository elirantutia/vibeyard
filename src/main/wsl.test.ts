import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('os', () => ({
  tmpdir: () => 'C:\\Users\\test\\AppData\\Local\\Temp',
  homedir: () => 'C:\\Users\\test',
}));

vi.mock('./platform', () => ({
  isWin: true,
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execFileSync } from 'child_process';

const mockExecFileSync = vi.mocked(execFileSync);

type WslModule = typeof import('./wsl');
let wsl: WslModule;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  wsl = await import('./wsl');
});

describe('isWslAvailable', () => {
  it('returns true when wsl --status succeeds', () => {
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    expect(wsl.isWslAvailable()).toBe(true);
  });

  it('returns false when wsl --status throws', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('not found'); });
    expect(wsl.isWslAvailable()).toBe(false);
  });

  it('caches the result', () => {
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    wsl.isWslAvailable();
    wsl.isWslAvailable();
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });
});

describe('getWslDistros', () => {
  it('parses distro names from wsl --list --quiet output', () => {
    // isWslAvailable probe
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    // --list --quiet
    mockExecFileSync.mockReturnValueOnce('Ubuntu\r\nDebian\r\n' as any);

    const distros = wsl.getWslDistros();
    expect(distros).toEqual(['Ubuntu', 'Debian']);
  });

  it('returns empty array when WSL is not available', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('no wsl'); });
    expect(wsl.getWslDistros()).toEqual([]);
  });
});

describe('getDefaultWslDistro', () => {
  it('identifies the default distro from verbose listing', () => {
    // isWslAvailable
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    // --list --verbose
    mockExecFileSync.mockReturnValueOnce(
      '  NAME      STATE    VERSION\r\n* Ubuntu    Running  2\r\n  Debian    Stopped  2\r\n' as any
    );

    expect(wsl.getDefaultWslDistro()).toBe('Ubuntu');
  });
});

describe('winPathToWsl', () => {
  it('converts drive-letter paths via heuristic without calling wsl', () => {
    expect(wsl.winPathToWsl('C:\\Users\\test\\project')).toBe('/mnt/c/Users/test/project');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('normalizes \\\\wsl$\\ UNC to a Linux path without calling wslpath', () => {
    expect(wsl.winPathToWsl('\\\\wsl$\\Ubuntu\\home\\u\\proj')).toBe('/home/u/proj');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('converts paths with parentheses via heuristic without calling wsl', () => {
    expect(wsl.winPathToWsl('C:\\Users\\test\\(parens)\\x')).toBe('/mnt/c/Users/test/(parens)/x');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('uses wslpath -u when the path is not a drive-letter path or wsl$ UNC', () => {
    mockExecFileSync.mockReturnValueOnce('/mnt/c/from-wslpath\n' as any);
    expect(wsl.winPathToWsl('\\\\?\\Volume{abc}\\x', 'Ubuntu')).toBe('/mnt/c/from-wslpath');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Ubuntu', '-e', 'wslpath', '-u', '\\\\?\\Volume{abc}\\x'],
      expect.objectContaining({ timeout: 3000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
    );
  });

  it('falls back to forward slashes when wslpath fails for non-drive paths', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('wslpath fail'); });
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('wslpath fail'); });
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('wslpath fail'); });
    // Heuristic skipped; wslpath fails; final replace only flips backslashes (no /mnt mapping)
    expect(wsl.winPathToWsl('\\\\?\\Z:\\odd\\path', 'Ubuntu')).toBe('//?/Z:/odd/path');
  });
});

describe('wslPathToWin', () => {
  it('maps Linux home paths to \\\\wsl$\\ UNC without calling wsl', () => {
    expect(wsl.wslPathToWin('/home/user', 'Ubuntu')).toBe('\\\\wsl$\\Ubuntu\\home\\user');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('maps pure Linux project paths to UNC', () => {
    expect(wsl.wslPathToWin('/home/user/project', 'Ubuntu')).toBe('\\\\wsl$\\Ubuntu\\home\\user\\project');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('maps /mnt/ paths back to a Windows drive letter', () => {
    expect(wsl.wslPathToWin('/mnt/c/Users/test', 'Ubuntu')).toBe('C:\\Users\\test');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });

  it('maps paths with parentheses to UNC without subprocesses', () => {
    expect(wsl.wslPathToWin('/home/user/(app)/page.tsx', 'Ubuntu')).toBe(
      '\\\\wsl$\\Ubuntu\\home\\user\\(app)\\page.tsx',
    );
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

describe('uncWslPathToLinuxPath', () => {
  it('strips \\\\wsl$\\ distro prefix', () => {
    expect(wsl.uncWslPathToLinuxPath('\\\\wsl$\\Ubuntu\\home\\user\\repo')).toBe('/home/user/repo');
  });

  it('strips \\\\wsl.localhost\\ prefix', () => {
    expect(wsl.uncWslPathToLinuxPath('\\\\wsl.localhost\\Ubuntu\\home\\user')).toBe('/home/user');
  });

  it('returns null for non-UNC paths', () => {
    expect(wsl.uncWslPathToLinuxPath('C:\\foo')).toBeNull();
  });
});

describe('normalizeProjectPathForWslStorage', () => {
  it('normalizes UNC to Linux path', () => {
    expect(wsl.normalizeProjectPathForWslStorage('\\\\wsl$\\Ubuntu\\home\\scrot\\code')).toBe('/home/scrot/code');
  });

  it('passes through and collapses POSIX paths', () => {
    expect(wsl.normalizeProjectPathForWslStorage('/home/scrot/code//')).toBe('/home/scrot/code');
  });
});

describe('getWslHome', () => {
  it('returns home directory from WSL', () => {
    mockExecFileSync.mockReturnValueOnce('/home/testuser\n');

    expect(wsl.getWslHome('Ubuntu')).toBe('/home/testuser');
  });

  it('falls back to /root on error', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('fail'); });

    expect(wsl.getWslHome('Ubuntu')).toBe('/root');
  });
});

describe('getSharedTempDir', () => {
  it('converts Windows temp to WSL path via heuristic', () => {
    expect(wsl.getSharedTempDir()).toBe('/mnt/c/Users/test/AppData/Local/Temp');
    expect(mockExecFileSync).not.toHaveBeenCalled();
  });
});

describe('getEffectiveDistro', () => {
  it('uses preference when valid', () => {
    // isWslAvailable
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    // getWslDistros → --list --quiet
    mockExecFileSync.mockReturnValueOnce('Ubuntu\r\nDebian\r\n' as any);

    expect(wsl.getEffectiveDistro('Debian')).toBe('Debian');
  });

  it('falls back to default when preference not in list', () => {
    // isWslAvailable
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    // getWslDistros → --list --quiet
    mockExecFileSync.mockReturnValueOnce('Ubuntu\r\n' as any);
    // getDefaultWslDistro → --list --verbose
    mockExecFileSync.mockReturnValueOnce('* Ubuntu  Running  2\r\n' as any);

    expect(wsl.getEffectiveDistro('NonExistent')).toBe('Ubuntu');
  });
});
