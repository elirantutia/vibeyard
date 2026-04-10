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
  it('converts via wslpath when available', () => {
    // isWslAvailable
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    // getDefaultWslDistro → --list --verbose
    mockExecFileSync.mockReturnValueOnce('* Ubuntu  Running  2\r\n' as any);
    // wslpath call
    mockExecFileSync.mockReturnValueOnce('/mnt/c/Users/test/project\n' as any);

    expect(wsl.winPathToWsl('C:\\Users\\test\\project')).toBe('/mnt/c/Users/test/project');
  });

  it('falls back to heuristic when wslpath fails', () => {
    // isWslAvailable
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    // getDefaultWslDistro
    mockExecFileSync.mockReturnValueOnce('* Ubuntu  Running  2\r\n' as any);
    // wslpath throws
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('wslpath fail'); });

    expect(wsl.winPathToWsl('D:\\code\\repo')).toBe('/mnt/d/code/repo');
  });

  it('uses -e for wslpath -u so the default shell does not mangle backslashes or special chars', () => {
    mockExecFileSync.mockReturnValueOnce('/mnt/c/Users/test/(parens)/x\n' as any);
    wsl.winPathToWsl('C:\\Users\\test\\(parens)\\x', 'Ubuntu');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Ubuntu', '-e', 'wslpath', '-u', 'C:\\Users\\test\\(parens)\\x'],
      expect.objectContaining({ timeout: 3000, encoding: 'utf8' }),
    );
  });
});

describe('wslPathToWin', () => {
  it('converts via wslpath when available', () => {
    // isWslAvailable
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    // getDefaultWslDistro
    mockExecFileSync.mockReturnValueOnce('* Ubuntu  Running  2\r\n' as any);
    // wslpath -w
    mockExecFileSync.mockReturnValueOnce('\\\\wsl$\\Ubuntu\\home\\user\n' as any);

    expect(wsl.wslPathToWin('/home/user')).toBe('\\\\wsl$\\Ubuntu\\home\\user');
  });

  it('falls back to UNC construction for pure Linux paths', () => {
    // wslpath throws (distro passed explicitly, no isWslAvailable needed for the path itself)
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('fail'); });

    expect(wsl.wslPathToWin('/home/user/project', 'Ubuntu')).toBe('\\\\wsl$\\Ubuntu\\home\\user\\project');
  });

  it('falls back to drive letter for /mnt/ paths', () => {
    mockExecFileSync.mockImplementationOnce(() => { throw new Error('fail'); });

    expect(wsl.wslPathToWin('/mnt/c/Users/test', 'Ubuntu')).toBe('C:\\Users\\test');
  });

  it('uses -e for wslpath -w so paths with parentheses are not parsed by bash', () => {
    mockExecFileSync.mockReturnValueOnce('\\\\wsl$\\Ubuntu\\home\\user\\(app)\\page.tsx\n' as any);
    wsl.wslPathToWin('/home/user/(app)/page.tsx', 'Ubuntu');
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'wsl.exe',
      ['-d', 'Ubuntu', '-e', 'wslpath', '-w', '/home/user/(app)/page.tsx'],
      expect.objectContaining({ timeout: 3000, encoding: 'utf8' }),
    );
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
  it('converts Windows temp to WSL path', () => {
    // isWslAvailable
    mockExecFileSync.mockReturnValueOnce(Buffer.from('') as any);
    // getDefaultWslDistro
    mockExecFileSync.mockReturnValueOnce('* Ubuntu  Running  2\r\n' as any);
    // wslpath -u for temp dir
    mockExecFileSync.mockReturnValueOnce('/mnt/c/Users/test/AppData/Local/Temp\n' as any);

    expect(wsl.getSharedTempDir()).toBe('/mnt/c/Users/test/AppData/Local/Temp');
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
