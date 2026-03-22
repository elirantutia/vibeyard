import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  watch: vi.fn(),
}));

vi.mock('os', () => ({
  tmpdir: () => '/tmp',
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

      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/ccide', { recursive: true, mode: 0o700 });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/ccide/statusline.sh',
        expect.stringContaining('#!/bin/sh'),
        { mode: 0o755 },
      );
    });
  });

  describe('startWatching', () => {
    it('creates dir and calls fs.watch', () => {
      const win = createMockWin();
      startWatching(win);

      expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/ccide', { recursive: true, mode: 0o700 });
      expect(fs.watch).toHaveBeenCalledWith('/tmp/ccide', expect.any(Function));
    });
  });

  describe('file change handling', () => {
    it('.status with valid content sends session:hookStatus', () => {
      const win = createMockWin();
      startWatching(win);

      vi.mocked(fs.readFileSync).mockReturnValue('working');
      watchCallback!('change', 'abc123.status');

      expect(mockSend).toHaveBeenCalledWith('session:hookStatus', 'abc123', 'working');
    });

    it('.status with invalid content does not send', () => {
      const win = createMockWin();
      startWatching(win);

      vi.mocked(fs.readFileSync).mockReturnValue('invalid-status');
      watchCallback!('change', 'abc123.status');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('.sessionid sends session:cliSessionId and session:claudeSessionId', () => {
      const win = createMockWin();
      startWatching(win);

      vi.mocked(fs.readFileSync).mockReturnValue('claude-session-xyz');
      watchCallback!('change', 'abc123.sessionid');

      expect(mockSend).toHaveBeenCalledWith('session:cliSessionId', 'abc123', 'claude-session-xyz');
      expect(mockSend).toHaveBeenCalledWith('session:claudeSessionId', 'abc123', 'claude-session-xyz');
    });

    it('.cost parses JSON and sends session:costData', () => {
      const win = createMockWin();
      startWatching(win);

      const costData = { cost: { total: 1.5 }, context_window: { used: 100 } };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(costData));
      watchCallback!('change', 'abc123.cost');

      expect(mockSend).toHaveBeenCalledWith('session:costData', 'abc123', costData);
    });

    it('.toolfailure parses JSON, sends session:toolFailure, and deletes file', () => {
      const win = createMockWin();
      startWatching(win);

      const failureData = { tool_name: 'Bash', tool_input: { command: 'gh pr list' }, error: 'exit 127' };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(failureData));
      watchCallback!('change', 'abc123-xyzabc.toolfailure');

      expect(mockSend).toHaveBeenCalledWith('session:toolFailure', 'abc123', failureData);
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/abc123-xyzabc.toolfailure');
    });

    it('.toolfailure extracts session ID from filename with random suffix', () => {
      const win = createMockWin();
      startWatching(win);

      const failureData = { tool_name: 'Bash', tool_input: { command: 'jq .' }, error: 'exit 127' };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(failureData));
      watchCallback!('change', 'my-session-id-abcdef.toolfailure');

      expect(mockSend).toHaveBeenCalledWith('session:toolFailure', 'my-session-id', failureData);
    });

    it('.toolfailure cleans up file even when JSON parsing fails', () => {
      const win = createMockWin();
      startWatching(win);

      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');
      watchCallback!('change', 'abc123-xyzabc.toolfailure');

      expect(mockSend).not.toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/abc123-xyzabc.toolfailure');
    });

    it('handles read errors gracefully', () => {
      const win = createMockWin();
      startWatching(win);

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

      destroyableWin.isDestroyed.mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('working');
      watchCallback!('change', 'abc123.status');

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('resyncs all sessions on null filename', () => {
      const win = createMockWin();
      startWatching(win);

      vi.mocked(fs.readdirSync).mockReturnValue(['abc123.cost'] as any);
      const costData = { cost: { total: 1.0 }, context_window: {} };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(costData));

      watchCallback!('change', null);

      expect(fs.readdirSync).toHaveBeenCalledWith('/tmp/ccide');
      expect(mockSend).toHaveBeenCalledWith('session:costData', 'abc123', costData);
    });
  });

  describe('resyncAllSessions', () => {
    it('processes all matching files in dir', () => {
      const win = createMockWin();
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

      expect(mockSend).toHaveBeenCalledWith('session:hookStatus', 's1', 'waiting');
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

      expect(fs.watch).toHaveBeenCalledWith('/tmp/ccide', expect.any(Function));
      expect(fs.readdirSync).toHaveBeenCalledWith('/tmp/ccide');
    });
  });

  describe('cleanupSessionStatus', () => {
    it('unlinks all 4 file types', () => {
      cleanupSessionStatus('sess-1');

      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/sess-1.status');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/sess-1.sessionid');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/sess-1.cost');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/sess-1.toolfailure');
      expect(fs.unlinkSync).toHaveBeenCalledTimes(4);
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
    it('closes watcher, removes matching files, script, and dir', () => {
      const win = createMockWin();
      startWatching(win);
      vi.clearAllMocks();

      vi.mocked(fs.readdirSync).mockReturnValue([
        'a.status',
        'b.sessionid',
        'c.cost',
        'other.log',
      ] as any);

      cleanupAll();

      expect(mockClose).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/a.status');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/b.sessionid');
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/c.cost');
      // statusline.sh removal
      expect(fs.unlinkSync).toHaveBeenCalledWith('/tmp/ccide/statusline.sh');
      expect(fs.rmdirSync).toHaveBeenCalledWith('/tmp/ccide');
      // 'other.log' should not be unlinked (3 matching + 1 script = 4)
      expect(fs.unlinkSync).toHaveBeenCalledTimes(4);
    });

    it('handles missing directory gracefully', () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      expect(() => cleanupAll()).not.toThrow();
    });
  });
});
