import { vi } from 'vitest';
import * as path from 'path';
import { isWin } from './platform';

const { mockSpawn, mockWrite, mockResize, mockKill, mockExecFile, mockNvmDefaultNodeBinDir } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockWrite: vi.fn(),
  mockResize: vi.fn(),
  mockKill: vi.fn(),
  mockExecFile: vi.fn(),
  mockNvmDefaultNodeBinDir: vi.fn(() => null as string | null),
}));

vi.mock('node-pty', () => ({
  default: { spawn: mockSpawn },
  spawn: mockSpawn,
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => { throw new Error('not found'); }),
  execFile: mockExecFile,
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
  tmpdir: () => '/tmp',
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  statSync: vi.fn(() => { throw new Error('ENOENT'); }),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
  readdirSync: vi.fn(() => { throw new Error('ENOENT'); }),
}));

vi.mock('./providers/nvm', () => ({
  nvmDefaultNodeBinDir: mockNvmDefaultNodeBinDir,
  findBinaryInNvm: vi.fn(() => null),
}));

import * as fs from 'fs';
import * as child_process from 'child_process';
import { spawnPty, writePty, resizePty, killPty, getPtyCwd, getRegistryPath, getFullPath, resetPathCache, resolveWindowsShell } from './pty-manager';
import { initProviders } from './providers/registry';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockStatSync = vi.mocked(fs.statSync);
const fileStat = { isFile: () => true } as fs.Stats;

function createMockPtyProcess() {
  const dataCallbacks: ((data: string) => void)[] = [];
  const exitCallbacks: ((info: { exitCode: number; signal?: number }) => void)[] = [];
  const proc = {
    onData: vi.fn((cb: (data: string) => void) => { dataCallbacks.push(cb); }),
    onExit: vi.fn((cb: (info: { exitCode: number; signal?: number }) => void) => { exitCallbacks.push(cb); }),
    write: mockWrite,
    resize: mockResize,
    kill: mockKill,
    _emitData: (data: string) => dataCallbacks.forEach(cb => cb(data)),
    _emitExit: (exitCode: number, signal?: number) => exitCallbacks.forEach(cb => cb({ exitCode, signal })),
  };
  return proc;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  initProviders();
});

describe('spawnPty', () => {
  it('spawns a PTY process with correct args', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    if (isWin) {
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'claude'],
        expect.objectContaining({
          cwd: '/project',
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
        }),
      );
    } else {
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        [],
        expect.objectContaining({
          cwd: '/project',
          name: 'xterm-256color',
          cols: 120,
          rows: 30,
        }),
      );
    }
  });

  it('adds -r flag when resuming with cliSessionId', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', 'claude-123', true, '', 'claude', undefined, vi.fn(), vi.fn());

    if (isWin) {
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'claude', '-r', 'claude-123'],
        expect.any(Object),
      );
    } else {
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['-r', 'claude-123'],
        expect.any(Object),
      );
    }
  });

  it('adds --session-id flag when not resuming', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', 'claude-123', false, '', 'claude', undefined, vi.fn(), vi.fn());

    if (isWin) {
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'claude', '--session-id', 'claude-123'],
        expect.any(Object),
      );
    } else {
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--session-id', 'claude-123'],
        expect.any(Object),
      );
    }
  });

  it('splits extraArgs into individual args', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', null, false, '--verbose --debug', 'claude', undefined, vi.fn(), vi.fn());

    if (isWin) {
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'claude', '--verbose', '--debug'],
        expect.any(Object),
      );
    } else {
      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--verbose', '--debug'],
        expect.any(Object),
      );
    }
  });

  it('forwards PTY data to callback', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    const onData = vi.fn();

    spawnPty('s1', '/project', null, false, '', 'claude', undefined, onData, vi.fn());
    proc._emitData('hello');

    expect(onData).toHaveBeenCalledWith('hello');
  });

  it('forwards exit event to callback', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    const onExit = vi.fn();

    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), onExit);
    proc._emitExit(0, 0);

    expect(onExit).toHaveBeenCalledWith(0, 0);
  });

  it('uses resolved claude path when found', async () => {
    // Must reset modules to clear cachedClaudePath from prior tests
    vi.resetModules();
    const expectedPath = isWin
      ? path.join('/mock/home', 'AppData', 'Roaming', 'npm', 'claude.cmd')
      : '/usr/local/bin/claude';
    mockStatSync.mockImplementation((p) => {
      if (String(p) === expectedPath) return fileStat;
      throw new Error('ENOENT');
    });
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    const { initProviders: freshInit } = await import('./providers/registry');
    const { spawnPty: freshSpawnPty } = await import('./pty-manager');
    freshInit();
    freshSpawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    if (isWin) {
      // On Windows, .cmd files are wrapped with cmd.exe /c
      expect(mockSpawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', expectedPath],
        expect.any(Object),
      );
    } else {
      expect(mockSpawn).toHaveBeenCalledWith(
        expectedPath,
        [],
        expect.any(Object),
      );
    }
  });

  it('sets required env vars', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    const env = mockSpawn.mock.calls[0][2].env;
    expect(env.CLAUDE_IDE_SESSION_ID).toBe('s1');
    expect(env.CLAUDE_CODE).toBeUndefined();
  });

  it('augments PATH with extra directories', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    const envPath = mockSpawn.mock.calls[0][2].env.PATH;
    if (isWin) {
      expect(envPath).toContain(path.join('/mock/home', 'AppData', 'Roaming', 'npm'));
    } else {
      expect(envPath).toContain('/usr/local/bin');
      expect(envPath).toContain('/opt/homebrew/bin');
      expect(envPath).toContain('/mock/home/.local/bin');
    }
  });
});

describe('writePty', () => {
  it('writes to existing PTY', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    writePty('s1', 'input');
    expect(mockWrite).toHaveBeenCalledWith('input');
  });

  it('does nothing for unknown session', () => {
    writePty('unknown', 'input');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('resizePty', () => {
  it('resizes existing PTY', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    resizePty('s1', 200, 50);
    expect(mockResize).toHaveBeenCalledWith(200, 50);
  });

  // Regression test for #70: node-pty on Windows throws synchronously from
  // WindowsPtyAgent.resize when the underlying child has exited. Before the
  // fix, this crashed the main process and killed every open session.
  it('swallows errors from node-pty on already-exited PTY (issue #70)', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    mockResize.mockImplementationOnce(() => {
      throw new Error('Cannot resize a pty that has already exited');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => resizePty('s1', 120, 30)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('s1'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('resizePty'));
    warnSpy.mockRestore();

    // After an "already exited" error the handle must be dropped —
    // a subsequent resize on the same session is a no-op.
    mockResize.mockClear();
    resizePty('s1', 80, 24);
    expect(mockResize).not.toHaveBeenCalled();
  });

  // The map is pruned ONLY when the error signals process exit. A transient
  // or unknown error must leave the handle intact so retries can succeed,
  // otherwise the session would silently become unresponsive.
  it('keeps the handle on transient (non-exit) errors (issue #70 review)', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    mockResize.mockImplementationOnce(() => {
      throw new Error('EBUSY: some transient failure');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => resizePty('s1', 120, 30)).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('s1'));
    warnSpy.mockRestore();

    // Handle is still registered — a subsequent successful resize must go through.
    mockResize.mockClear();
    resizePty('s1', 80, 24);
    expect(mockResize).toHaveBeenCalledWith(80, 24);
  });
});

describe('writePty error handling (issue #70)', () => {
  it('swallows errors when writing to an already-exited PTY', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    mockWrite.mockImplementationOnce(() => {
      throw new Error('Cannot write to a pty that has already exited');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => writePty('s1', 'hello')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('s1'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('writePty'));
    warnSpy.mockRestore();

    // Handle dropped — subsequent write is a no-op.
    mockWrite.mockClear();
    writePty('s1', 'again');
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('keeps the handle on transient (non-exit) errors (issue #70 review)', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    mockWrite.mockImplementationOnce(() => {
      throw new Error('EAGAIN: resource temporarily unavailable');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => writePty('s1', 'hello')).not.toThrow();
    warnSpy.mockRestore();

    // Handle still registered — subsequent successful write must go through.
    mockWrite.mockClear();
    writePty('s1', 'again');
    expect(mockWrite).toHaveBeenCalledWith('again');
  });

  // Security-review follow-up: sessionId arrives from the renderer over IPC
  // and must be sanitised in log output so that crafted values (newlines,
  // ANSI escape sequences) cannot confuse log consumers.
  it('sanitises sessionId with control characters in log output', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    const hostileId = "evil\n[pty-manager] fake log line\x1b[31m";
    spawnPty(hostileId, '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    mockWrite.mockImplementationOnce(() => {
      throw new Error('Cannot write to a pty that has already exited');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    writePty(hostileId, 'hello');

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0][0] as string;
    // Raw newline/ESC must not appear in the logged string — JSON.stringify
    // must have escaped them.
    expect(logged).not.toMatch(/\n(?!$)/);
    expect(logged).not.toContain('\x1b');
    expect(logged).toContain('\\n');
    warnSpy.mockRestore();
  });
});

describe('killPty error handling (issue #70)', () => {
  it('swallows errors when killing an already-exited PTY and still drops the handle', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    mockKill.mockImplementationOnce(() => {
      throw new Error('Cannot kill a pty that has already exited');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => killPty('s1')).not.toThrow();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('s1'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('killPty'));
    // After kill (even if it throws), a subsequent resize must be a no-op —
    // the handle is gone, so mockResize must not be called.
    mockResize.mockClear();
    resizePty('s1', 120, 30);
    expect(mockResize).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('killPty', () => {
  it('kills and removes PTY', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    killPty('s1');
    expect(mockKill).toHaveBeenCalled();

    // Writing after kill should be a no-op
    mockWrite.mockClear();
    writePty('s1', 'input');
    expect(mockWrite).not.toHaveBeenCalled();
  });
});

describe('getPtyCwd', () => {
  it('returns null for unknown session', async () => {
    const result = await getPtyCwd('unknown');
    expect(result).toBeNull();
  });

  it('returns cwd of deepest child process', async () => {
    const proc = createMockPtyProcess();
    (proc as unknown as { pid: number }).pid = 1000;
    mockSpawn.mockReturnValue(proc);
    spawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    if (isWin) {
      // On Windows, getPtyCwd always returns null (not supported)
      const result = await getPtyCwd('s1');
      expect(result).toBeNull();
      return;
    }

    // pgrep for pid 1000 returns child 2000
    mockExecFile.mockImplementationOnce((_cmd: string, args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      if (args[1] === '1000') callback(null, '2000\n');
      return undefined as never;
    });

    // pgrep for pid 2000 returns no children (error)
    mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      callback(new Error('no children'), '');
      return undefined as never;
    });

    // lsof for pid 2000
    mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      callback(null, 'p2000\nfcwd\nn/some/worktree/path\n');
      return undefined as never;
    });

    const result = await getPtyCwd('s1');
    expect(result).toBe('/some/worktree/path');
  });

  it('returns null when lsof fails', async () => {
    const proc = createMockPtyProcess();
    (proc as unknown as { pid: number }).pid = 1000;
    mockSpawn.mockReturnValue(proc);
    spawnPty('s2', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    // pgrep returns no children
    mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      callback(new Error('no children'), '');
      return undefined as never;
    });

    // lsof fails
    mockExecFile.mockImplementationOnce((_cmd: string, _args: string[], _opts: unknown, callback: (err: Error | null, stdout: string) => void) => {
      callback(new Error('lsof failed'), '');
      return undefined as never;
    });

    const result = await getPtyCwd('s2');
    expect(result).toBeNull();
  });
});

const mockExecSync = vi.mocked(child_process.execSync);

describe('getRegistryPath', () => {
  beforeEach(() => {
    resetPathCache();
  });

  if (isWin) {
    it('parses REG_SZ registry output', () => {
      mockExecSync
        .mockReturnValueOnce(
          '\r\nHKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment\r\n    Path    REG_SZ    C:\\Windows\\system32;C:\\Windows\r\n\r\n',
        )
        .mockReturnValueOnce(
          '\r\nHKCU\\Environment\r\n    Path    REG_SZ    C:\\Users\\test\\AppData\\Roaming\\npm\r\n\r\n',
        );

      const result = getRegistryPath();
      expect(result).toContain('C:\\Windows\\system32;C:\\Windows');
      expect(result).toContain('C:\\Users\\test\\AppData\\Roaming\\npm');
    });

    it('expands %VAR% references in REG_EXPAND_SZ values', () => {
      process.env.SystemRoot = 'C:\\Windows';
      process.env.USERPROFILE = 'C:\\Users\\test';

      mockExecSync
        .mockReturnValueOnce(
          '    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;%SystemRoot%\r\n',
        )
        .mockReturnValueOnce(
          '    Path    REG_EXPAND_SZ    %USERPROFILE%\\AppData\\Roaming\\npm\r\n',
        );

      const result = getRegistryPath();
      expect(result).toContain('C:\\Windows\\system32');
      expect(result).toContain('C:\\Users\\test\\AppData\\Roaming\\npm');
      expect(result).not.toContain('%SystemRoot%');
      expect(result).not.toContain('%USERPROFILE%');
    });

    it('returns empty string when registry queries fail', () => {
      mockExecSync.mockImplementation(() => { throw new Error('access denied'); });

      const result = getRegistryPath();
      expect(result).toBe('');
    });

    it('handles partial failure (system path fails, user path succeeds)', () => {
      mockExecSync
        .mockImplementationOnce(() => { throw new Error('access denied'); })
        .mockReturnValueOnce(
          '    Path    REG_SZ    C:\\Users\\test\\AppData\\Roaming\\npm\r\n',
        );

      const result = getRegistryPath();
      expect(result).toContain('C:\\Users\\test\\AppData\\Roaming\\npm');
    });
  } else {
    it('returns empty string on non-Windows', () => {
      expect(getRegistryPath()).toBe('');
    });
  }
});

describe('getFullPath (macOS)', () => {
  if (isWin) {
    it.skip('macOS-only', () => {});
    return;
  }

  beforeEach(() => {
    resetPathCache();
    mockNvmDefaultNodeBinDir.mockReturnValue(null);
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
  });

  it('parses PATH from output with plugin garbage around the marker block', () => {
    mockExecSync.mockImplementation(() =>
      'p10k instant prompt noise\n' +
      '\x1b[?2004h__VY_PATH_BEGIN__/opt/homebrew/bin:/usr/local/bin__VY_PATH_END__\n' +
      'trailing zshrc chatter\n',
    );
    const result = getFullPath();
    expect(result).toBe('/opt/homebrew/bin:/usr/local/bin');
  });

  it('invokes the shell with -ilc (regression guard: do not drop -i)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      expect(cmd).toContain('-ilc');
      return '__VY_PATH_BEGIN__/usr/bin__VY_PATH_END__\n';
    });
    getFullPath();
    expect(mockExecSync).toHaveBeenCalled();
  });

  it('caches both successful and fallback results; resetPathCache allows retry', () => {
    mockExecSync.mockImplementation(() => { throw new Error('timeout'); });
    getFullPath();
    getFullPath();
    expect(mockExecSync).toHaveBeenCalledTimes(1);

    resetPathCache();
    mockExecSync.mockImplementation(() => '__VY_PATH_BEGIN__/usr/bin__VY_PATH_END__');
    const second = getFullPath();
    expect(second).toBe('/usr/bin');
    expect(mockExecSync).toHaveBeenCalledTimes(2);
  });

  it('appends nvm default node bin to the fallback PATH when discoverable', () => {
    mockNvmDefaultNodeBinDir.mockReturnValue('/mock/home/.nvm/versions/node/v24.11.1/bin');
    mockExecSync.mockImplementation(() => { throw new Error('no shell'); });
    const result = getFullPath();
    expect(result).toContain('/mock/home/.nvm/versions/node/v24.11.1/bin');
    expect(result).toContain('/opt/homebrew/bin');
  });
});

describe('resolveWindowsShell', () => {
  if (isWin) {
    it('wraps .cmd files with cmd.exe /c', () => {
      const result = resolveWindowsShell('C:\\Users\\test\\npm\\claude.cmd', ['--help']);
      expect(result).toEqual({
        shell: 'cmd.exe',
        args: ['/c', 'C:\\Users\\test\\npm\\claude.cmd', '--help'],
      });
    });

    it('wraps .bat files with cmd.exe /c', () => {
      const result = resolveWindowsShell('C:\\tools\\run.bat', ['-v']);
      expect(result).toEqual({
        shell: 'cmd.exe',
        args: ['/c', 'C:\\tools\\run.bat', '-v'],
      });
    });

    it('wraps .ps1 files with powershell.exe', () => {
      const result = resolveWindowsShell('C:\\scripts\\tool.ps1', ['arg1']);
      expect(result).toEqual({
        shell: 'powershell.exe',
        args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\scripts\\tool.ps1', 'arg1'],
      });
    });

    it('passes .exe files through unchanged', () => {
      const result = resolveWindowsShell('C:\\tools\\claude.exe', ['--help']);
      expect(result).toEqual({
        shell: 'C:\\tools\\claude.exe',
        args: ['--help'],
      });
    });

    it('wraps bare binary names with cmd.exe /c', () => {
      const result = resolveWindowsShell('claude', ['--help']);
      expect(result).toEqual({
        shell: 'cmd.exe',
        args: ['/c', 'claude', '--help'],
      });
    });

    it('wraps absolute extensionless paths with cmd.exe /c', () => {
      const result = resolveWindowsShell('C:\\tools\\claude', ['--help']);
      expect(result).toEqual({
        shell: 'cmd.exe',
        args: ['/c', 'C:\\tools\\claude', '--help'],
      });
    });
  } else {
    it('passes through unchanged on non-Windows', () => {
      const result = resolveWindowsShell('/usr/local/bin/claude', ['--help']);
      expect(result).toEqual({
        shell: '/usr/local/bin/claude',
        args: ['--help'],
      });
    });
  }
});
