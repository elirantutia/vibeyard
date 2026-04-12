import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import { isWin } from './platform';

const STATUS_DIR = path.join('/tmp', 'vibeyard');
const SCRIPT_DIR = path.join('/home/test', '.vibeyard', 'run');
const STATUSLINE_SCRIPT = path.join(SCRIPT_DIR, isWin ? 'statusline.cmd' : 'statusline.sh');

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  rmSync: vi.fn(),
  watch: vi.fn(),
}));

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
  homedir: () => '/home/test',
}));

vi.mock('electron', () => ({
  BrowserWindow: {},
}));

import * as fs from 'fs';
import {
  installStatusLineScript,
  startWatching,
  resyncAllSessions,
  restartAndResync,
  cleanupSessionStatus,
  cleanupAll,
  registerSession,
} from './hook-status';

let watchCallback: ((eventType: string, filename: string | null) => void) | null = null;
const mockClose = vi.fn();

const mockSend = vi.fn();
function createMockWin(destroyed = false) {
  return { isDestroyed: () => destroyed, webContents: { send: mockSend } } as any;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  vi.mocked(fs.mkdirSync).mockImplementation(vi.fn() as any);
  vi.mocked(fs.writeFileSync).mockImplementation(vi.fn() as any);
  vi.mocked(fs.readFileSync).mockImplementation(vi.fn() as any);
  vi.mocked(fs.readdirSync).mockReturnValue([] as any);
  vi.mocked(fs.statSync).mockImplementation(vi.fn() as any);
  vi.mocked(fs.unlinkSync).mockImplementation(vi.fn() as any);
  vi.mocked(fs.rmdirSync).mockImplementation(vi.fn() as any);
  vi.mocked(fs.watch).mockImplementation((_path: any, cb: any) => {
    watchCallback = cb;
    return { close: mockClose } as any;
  });

  watchCallback = null;
  mockClose.mockClear();
  mockSend.mockClear();

  // Reset module-level watcher state
  cleanupAll();

  // Clear call counts after cleanup
  vi.clearAllMocks();
  watchCallback = null;

  vi.mocked(fs.watch).mockImplementation((_path: any, cb: any) => {
    watchCallback = cb;
    return { close: mockClose } as any;
  });
});

afterEach(() => {
  // Stop any polling intervals before restoring timers
  cleanupAll();
  vi.useRealTimers();
});

describe('hook-status', () => {
  describe('installStatusLineScript', () => {
    it('creates dir and writes script with mode 0o755', () => {
      installStatusLineScript();

      expect(fs.mkdirSync).toHaveBeenCalledWith(STATUS_DIR, { recursive: true, mode: 0o700 });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        STATUSLINE_SCRIPT,
        isWin ? expect.stringContaining('@echo off') : expect.stringContaining('#!/bin/sh'),
        { mode: 0o755 },
      );
    });
  });

  describe('startWatching', () => {
    it('creates dir and calls fs.watch', () => {
      const win = createMockWin();
      startWatching(win);

      expect(fs.mkdirSync).toHaveBeenCalledWith(STATUS_DIR, { recursive: true, mode: 0o700 });
      expect(fs.watch).toHaveBeenCalledWith(STATUS_DIR, expect.any(Function));
    });
  });

  describe('file change handling', () => {
    it('ignores file changes for unregistered sessions', () => {
      const win = createMockWin();
      startWatching(win);

      vi.mocked(fs.readFileSync).mockReturnValue('working');
      watchCallback!('change', 'unknown-session.status');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('.status with valid content sends session:hookStatus (legacy format)', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readFileSync).mockReturnValue('working');
      watchCallback!('change', 'abc123.status');

      expect(mockSend).toHaveBeenCalledWith('session:hookStatus', 'abc123', 'working', '');
    });

    it('.status with hook name sends session:hookStatus with hook name', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readFileSync).mockReturnValue('PostToolUse:working');
      watchCallback!('change', 'abc123.status');

      expect(mockSend).toHaveBeenCalledWith('session:hookStatus', 'abc123', 'working', 'PostToolUse');
    });

    it('.status with invalid content does not send', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readFileSync).mockReturnValue('invalid-status');
      watchCallback!('change', 'abc123.status');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('.sessionid sends session:cliSessionId and session:claudeSessionId', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readFileSync).mockReturnValue('claude-session-xyz');
      watchCallback!('change', 'abc123.sessionid');

      expect(mockSend).toHaveBeenCalledWith('session:cliSessionId', 'abc123', 'claude-session-xyz');
      expect(mockSend).toHaveBeenCalledWith('session:claudeSessionId', 'abc123', 'claude-session-xyz');
    });

    it('.cost parses JSON and sends session:costData', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      const costData = { cost: { total: 1.5 }, context_window: { used: 100 } };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(costData));
      watchCallback!('change', 'abc123.cost');

      expect(mockSend).toHaveBeenCalledWith('session:costData', 'abc123', costData);
    });

    it('.toolfailure parses JSON, sends session:toolFailure, and deletes file', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      const failureData = { tool_name: 'Bash', tool_input: { command: 'gh pr list' }, error: 'exit 127' };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(failureData));
      watchCallback!('change', 'abc123-xyzabc.toolfailure');

      expect(mockSend).toHaveBeenCalledWith('session:toolFailure', 'abc123', failureData);
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'abc123-xyzabc.toolfailure'));
    });

    it('.toolfailure extracts session ID from filename with random suffix', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('my-session-id');

      const failureData = { tool_name: 'Bash', tool_input: { command: 'jq .' }, error: 'exit 127' };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(failureData));
      watchCallback!('change', 'my-session-id-abcdef.toolfailure');

      expect(mockSend).toHaveBeenCalledWith('session:toolFailure', 'my-session-id', failureData);
    });

    it('.toolfailure cleans up file even when JSON parsing fails', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');
      watchCallback!('change', 'abc123-xyzabc.toolfailure');

      expect(mockSend).not.toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'abc123-xyzabc.toolfailure'));
    });

    it('handles read errors gracefully', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(() => watchCallback!('change', 'abc123.status')).not.toThrow();
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('skips sending when window is destroyed', () => {
      const win = createMockWin();
      startWatching(win);

      // Now make the window appear destroyed for the handleFileChange check
      // We need a win whose isDestroyed flips, so create a mutable one
      const destroyableWin = { isDestroyed: vi.fn().mockReturnValue(false), webContents: { send: mockSend } } as any;
      // Re-start watching with the destroyable win
      startWatching(destroyableWin);

      registerSession('abc123');
      destroyableWin.isDestroyed.mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('working');
      watchCallback!('change', 'abc123.status');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('resyncs all sessions on null filename', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readdirSync).mockReturnValue(['abc123.cost'] as any);
      const costData = { cost: { total: 1.0 }, context_window: {} };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(costData));

      watchCallback!('change', null);

      expect(fs.readdirSync).toHaveBeenCalledWith(STATUS_DIR);
      expect(mockSend).toHaveBeenCalledWith('session:costData', 'abc123', costData);
    });
  });

  describe('resyncAllSessions', () => {
    it('processes all matching files in dir', () => {
      const win = createMockWin();
      registerSession('s1');
      registerSession('s2');
      registerSession('s3');
      vi.mocked(fs.readdirSync).mockReturnValue([
        's1.status',
        's2.sessionid',
        's3.cost',
        'unrelated.txt',
      ] as any);

      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce('waiting')         // s1.status
        .mockReturnValueOnce('claude-sess-1')   // s2.sessionid
        .mockReturnValueOnce(JSON.stringify({ cost: {} })); // s3.cost

      resyncAllSessions(win);

      expect(mockSend).toHaveBeenCalledWith('session:hookStatus', 's1', 'waiting', '');
      expect(mockSend).toHaveBeenCalledWith('session:cliSessionId', 's2', 'claude-sess-1');
      expect(mockSend).toHaveBeenCalledWith('session:claudeSessionId', 's2', 'claude-sess-1');
      expect(mockSend).toHaveBeenCalledWith('session:costData', 's3', { cost: {} });
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it('is a no-op on destroyed window', () => {
      const win = createMockWin(true);
      resyncAllSessions(win);

      expect(fs.readdirSync).not.toHaveBeenCalled();
    });

    it('handles missing directory gracefully', () => {
      const win = createMockWin();
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(() => resyncAllSessions(win)).not.toThrow();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('restartAndResync', () => {
    it('calls both restartWatcher and resyncAllSessions', () => {
      const win = createMockWin();
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);

      restartAndResync(win);

      expect(fs.watch).toHaveBeenCalledWith(STATUS_DIR, expect.any(Function));
      expect(fs.readdirSync).toHaveBeenCalledWith(STATUS_DIR);
    });
  });

  describe('cleanupSessionStatus', () => {
    it('unlinks all 5 file types', () => {
      cleanupSessionStatus('sess-1');

      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.status'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.sessionid'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.cost'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.toolfailure'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.events'));
      expect(fs.unlinkSync).toHaveBeenCalledTimes(5);
    });

    it('handles errors when files do not exist', () => {
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(() => cleanupSessionStatus('sess-1')).not.toThrow();
    });
  });

  describe('polling fallback', () => {
    it('detects changed files on poll interval', () => {
      const win = createMockWin();
      registerSession('s1');

      // First poll seeds mtimes
      vi.mocked(fs.readdirSync).mockReturnValue(['s1.cost'] as any);
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as any);

      startWatching(win);

      // Advance to trigger first poll — seeds mtimes, no handleFileChange
      vi.advanceTimersByTime(2000);
      expect(mockSend).not.toHaveBeenCalled();

      // Now file has changed mtime
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 2000 } as any);
      const costData = { cost: { total: 0.5 }, context_window: {} };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(costData));

      vi.advanceTimersByTime(2000);
      expect(mockSend).toHaveBeenCalledWith('session:costData', 's1', costData);
    });

    it('skips files with unchanged mtime', () => {
      const win = createMockWin();

      vi.mocked(fs.readdirSync).mockReturnValue(['s1.cost'] as any);
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as any);

      startWatching(win);

      // Seed mtimes
      vi.advanceTimersByTime(2000);

      // Same mtime — no change
      vi.advanceTimersByTime(2000);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('stops polling on cleanupAll', () => {
      const win = createMockWin();
      startWatching(win);
      cleanupAll();

      vi.mocked(fs.readdirSync).mockReturnValue(['s1.cost'] as any);
      vi.mocked(fs.statSync).mockReturnValue({ mtimeMs: 1000 } as any);

      vi.advanceTimersByTime(4000);
      expect(fs.statSync).not.toHaveBeenCalled();
    });
  });

  describe('cleanupAll', () => {
    it('closes watcher, removes status files but keeps script dir', () => {
      const win = createMockWin();
      startWatching(win);
      vi.clearAllMocks();

      vi.mocked(fs.readdirSync).mockImplementation(((dir: string) => {
        if (dir === STATUS_DIR) {
          return ['a.status', 'b.sessionid', 'c.cost', 'other.log'];
        }
        return [];
      }) as any);

      cleanupAll();

      expect(mockClose).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'a.status'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'b.sessionid'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'c.cost'));
      expect(fs.rmSync).toHaveBeenCalledWith(STATUS_DIR, { recursive: true });
      // SCRIPT_DIR should NOT be cleaned up — scripts persist across restarts
      expect(fs.rmSync).not.toHaveBeenCalledWith(SCRIPT_DIR, { recursive: true });
      // 3 runtime files; 'other.log' skipped
      expect(fs.unlinkSync).toHaveBeenCalledTimes(3);
    });

    it('handles missing directory gracefully', () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(() => cleanupAll()).not.toThrow();
    });
  });
});
