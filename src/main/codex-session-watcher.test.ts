import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  statSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  watch: vi.fn(),
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
  tmpdir: () => '/tmp',
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

vi.mock('./hook-status', () => ({
  STATUS_DIR: '/tmp/vibeyard',
}));

import * as fs from 'fs';
import {
  registerPendingCodexSession,
  unregisterCodexSession,
  startCodexSessionWatcher,
  stopCodexSessionWatcher,
} from './codex-session-watcher';

const mockStatSync = vi.mocked(fs.statSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockReadSync = vi.mocked(fs.readSync);
const mockCloseSync = vi.mocked(fs.closeSync);
const mockWriteFileSync = vi.mocked(fs.writeFileSync);
const mockMkdirSync = vi.mocked(fs.mkdirSync);
const mockWatch = vi.mocked(fs.watch);

function createMockWin(): any {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  stopCodexSessionWatcher();
});

afterEach(() => {
  stopCodexSessionWatcher();
  vi.useRealTimers();
});

describe('registerPendingCodexSession', () => {
  it('records the current history file size on first registration', () => {
    mockStatSync.mockReturnValue({ size: 500 } as fs.Stats);
    registerPendingCodexSession('ui-1');
    expect(mockStatSync).toHaveBeenCalled();
  });

  it('does not reset lastSize when a second session registers', () => {
    // First registration at size 100
    mockStatSync.mockReturnValue({ size: 100 } as fs.Stats);
    registerPendingCodexSession('ui-1');

    // File grows to 200 (new entry written for ui-1)
    mockStatSync.mockReturnValue({ size: 200 } as fs.Stats);
    registerPendingCodexSession('ui-2');

    // statSync should only be called once (for ui-1), not for ui-2
    // because pendingSessions was non-empty when ui-2 registered
    expect(mockStatSync).toHaveBeenCalledTimes(1);
  });

  it('handles missing history file gracefully', () => {
    mockStatSync.mockImplementation(() => { throw new Error('ENOENT'); });
    expect(() => registerPendingCodexSession('ui-1')).not.toThrow();
  });
});

describe('startCodexSessionWatcher', () => {
  it('starts fs.watch on ~/.codex directory', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    const win = createMockWin();
    startCodexSessionWatcher(win);

    expect(mockWatch).toHaveBeenCalledWith(
      '/mock/home/.codex',
      expect.any(Function)
    );
  });

  it('does not start a second watcher if already started', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    const win = createMockWin();
    startCodexSessionWatcher(win);
    startCodexSessionWatcher(win);

    expect(mockWatch).toHaveBeenCalledTimes(1);
  });
});

describe('session ID assignment via polling', () => {
  it('assigns codex session ID to oldest pending session on poll', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    const win = createMockWin();
    startCodexSessionWatcher(win);

    // Register a pending session — file starts at size 0
    mockStatSync.mockReturnValue({ size: 0 } as fs.Stats);
    registerPendingCodexSession('ui-session-1');

    // Simulate history.jsonl growing with a new entry
    const newLine = '{"session_id":"codex-abc-123","ts":1774904000,"text":"hello"}\n';
    const buf = Buffer.from(newLine);
    mockStatSync.mockReturnValue({ size: buf.length } as fs.Stats);
    mockOpenSync.mockReturnValue(42);
    mockReadSync.mockImplementation((_fd, target: Buffer) => {
      buf.copy(target);
      return buf.length;
    });

    // Trigger poll interval (2000ms)
    vi.advanceTimersByTime(2000);

    // Should have written the .sessionid file
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/vibeyard', { recursive: true, mode: 0o700 });
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/vibeyard/ui-session-1.sessionid',
      'codex-abc-123'
    );
    expect(mockCloseSync).toHaveBeenCalledWith(42);
  });

  it('assigns to oldest pending session when multiple are pending', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    const win = createMockWin();
    startCodexSessionWatcher(win);

    mockStatSync.mockReturnValue({ size: 0 } as fs.Stats);
    registerPendingCodexSession('ui-older');

    // Advance time so second session has a later addedAt
    vi.advanceTimersByTime(100);
    registerPendingCodexSession('ui-newer');

    const newLine = '{"session_id":"codex-first","ts":1774904000,"text":"hey"}\n';
    const buf = Buffer.from(newLine);
    mockStatSync.mockReturnValue({ size: buf.length } as fs.Stats);
    mockOpenSync.mockReturnValue(10);
    mockReadSync.mockImplementation((_fd, target: Buffer) => {
      buf.copy(target);
      return buf.length;
    });

    vi.advanceTimersByTime(2000);

    // Should assign to the older session
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/vibeyard/ui-older.sessionid',
      'codex-first'
    );
  });

  it('does not assign the same codex session ID twice', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    const win = createMockWin();
    startCodexSessionWatcher(win);

    mockStatSync.mockReturnValue({ size: 0 } as fs.Stats);
    registerPendingCodexSession('ui-1');

    // First entry
    const line1 = '{"session_id":"codex-dup","ts":1774904000,"text":"a"}\n';
    const buf1 = Buffer.from(line1);
    mockStatSync.mockReturnValue({ size: buf1.length } as fs.Stats);
    mockOpenSync.mockReturnValue(10);
    mockReadSync.mockImplementation((_fd, target: Buffer) => {
      buf1.copy(target);
      return buf1.length;
    });
    vi.advanceTimersByTime(2000);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);

    // Register another pending session (pendingSessions was empty, so lastSize resets)
    mockStatSync.mockReturnValue({ size: buf1.length } as fs.Stats);
    registerPendingCodexSession('ui-2');

    // Same codex session ID appears again (second message in same session)
    const line2 = '{"session_id":"codex-dup","ts":1774904100,"text":"b"}\n';
    const buf2 = Buffer.from(line2);
    const totalSize = buf1.length + buf2.length;
    mockStatSync.mockReturnValue({ size: totalSize } as fs.Stats);
    mockOpenSync.mockReturnValue(11);
    mockReadSync.mockImplementation((_fd, target: Buffer) => {
      buf2.copy(target);
      return buf2.length;
    });
    vi.advanceTimersByTime(2000);

    // Should NOT have written a second .sessionid (same codex ID)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  it('does not read when no pending sessions', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    const win = createMockWin();
    startCodexSessionWatcher(win);

    vi.advanceTimersByTime(2000);

    // statSync should not be called for reading (only watcher setup)
    expect(mockOpenSync).not.toHaveBeenCalled();
  });
});

describe('unregisterCodexSession', () => {
  it('removes a pending session so it is no longer assignable', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    const win = createMockWin();
    startCodexSessionWatcher(win);

    mockStatSync.mockReturnValue({ size: 0 } as fs.Stats);
    registerPendingCodexSession('ui-gone');
    unregisterCodexSession('ui-gone');

    const newLine = '{"session_id":"codex-orphan","ts":1774904000,"text":"x"}\n';
    const buf = Buffer.from(newLine);
    mockStatSync.mockReturnValue({ size: buf.length } as fs.Stats);
    mockOpenSync.mockReturnValue(10);
    mockReadSync.mockImplementation((_fd, target: Buffer) => {
      buf.copy(target);
      return buf.length;
    });

    vi.advanceTimersByTime(2000);

    // No .sessionid file should be written
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });
});

describe('stopCodexSessionWatcher', () => {
  it('closes watcher and clears state', () => {
    const mockWatcher = { close: vi.fn() };
    mockWatch.mockReturnValue(mockWatcher as any);

    const win = createMockWin();
    startCodexSessionWatcher(win);

    mockStatSync.mockReturnValue({ size: 0 } as fs.Stats);
    registerPendingCodexSession('ui-1');

    stopCodexSessionWatcher();

    expect(mockWatcher.close).toHaveBeenCalled();
  });
});
