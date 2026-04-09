import { vi } from 'vitest';
import * as path from 'path';
import { isWin } from './platform';

const { mockSpawn, mockWrite, mockResize, mockKill, mockExecFile } = vi.hoisted(() => ({
  mockSpawn: vi.fn(),
  mockWrite: vi.fn(),
  mockResize: vi.fn(),
  mockKill: vi.fn(),
  mockExecFile: vi.fn(),
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
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => { throw new Error('ENOENT'); }),
  readdirSync: vi.fn(() => { throw new Error('ENOENT'); }),
}));

import * as fs from 'fs';
import { spawnPty, writePty, resizePty, killPty, getPtyCwd } from './pty-manager';
import { initProviders } from './providers/registry';

const mockExistsSync = vi.mocked(fs.existsSync);

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

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude', // falls back to bare 'claude'
      [],
      expect.objectContaining({
        cwd: '/project',
        name: 'xterm-256color',
        cols: 120,
        rows: 30,
      }),
    );
  });

  it('adds -r flag when resuming with cliSessionId', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', 'claude-123', true, '', 'claude', undefined, vi.fn(), vi.fn());

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['-r', 'claude-123'],
      expect.any(Object),
    );
  });

  it('adds --session-id flag when not resuming', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', 'claude-123', false, '', 'claude', undefined, vi.fn(), vi.fn());

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--session-id', 'claude-123'],
      expect.any(Object),
    );
  });

  it('splits extraArgs into individual args', () => {
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    spawnPty('s1', '/project', null, false, '--verbose --debug', 'claude', undefined, vi.fn(), vi.fn());

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      ['--verbose', '--debug'],
      expect.any(Object),
    );
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
    mockExistsSync.mockImplementation((p) => String(p) === expectedPath);
    const proc = createMockPtyProcess();
    mockSpawn.mockReturnValue(proc);

    const { initProviders: freshInit } = await import('./providers/registry');
    const { spawnPty: freshSpawnPty } = await import('./pty-manager');
    freshInit();
    freshSpawnPty('s1', '/project', null, false, '', 'claude', undefined, vi.fn(), vi.fn());

    expect(mockSpawn).toHaveBeenCalledWith(
      expectedPath,
      [],
      expect.any(Object),
    );
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
