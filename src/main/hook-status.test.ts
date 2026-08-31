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
  buildStatusLinePython,
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
  describe('buildStatusLinePython', () => {
    // Tested directly rather than through installStatusLineScript so the body
    // used by the Windows branch is exercised on every platform's CI run.
    const body = () => buildStatusLinePython(STATUS_DIR);

    // Feeds the script to python3 on stdin. PYTHONIOENCODING is required:
    // Node writes `input` as UTF-8, but on Windows sys.stdin defaults to the
    // locale codepage, so a non-ascii path comes back mojibake'd (\u00fc ->
    // \u00c3\u00bc). Production is unaffected — the body is written to a .py file,
    // and Python reads source files as UTF-8 regardless of locale.
    const runPython = (code: string, input: string) => {
      const { spawnSync } = require('child_process') as typeof import('child_process');
      const opts = { input, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } };
      return spawnSync('python3', ['-c', code], opts);
    };
    // Memoised: three tests probe for python3, and each probe is a process launch.
    let pythonAvailable: boolean | undefined;
    const hasPython = () => {
      if (pythonAvailable === undefined) {
        const { spawnSync } = require('child_process') as typeof import('child_process');
        pythonAvailable = !spawnSync('python3', ['-c', 'pass']).error;
      }
      return pythonAvailable;
    };

    it('extracts cost, context_window, session_id and session_name', () => {
      const script = body();
      for (const field of ['cost', 'context_window', 'session_id', 'session_name']) {
        expect(script).toContain(field);
      }
    });

    it('builds every path with os.path.join off the status_dir literal', () => {
      const script = body();
      expect(script).toContain(`status_dir=${JSON.stringify(STATUS_DIR)}`);
      for (const ext of ['.cost', '.sessionid', '.name']) {
        expect(script).toContain(`sid+'${ext}'`);
      }
      expect(script).not.toContain('status_dir+');
    });

    it.each([
      ['posix', '/tmp/vibeyard'],
      ['windows backslashes', 'C:\\Users\\dev\\Temp\\vibeyard'],
      ['apostrophe in path', "C:\\Users\\O'Brien\\Temp\\vibeyard"],
      ['double quote in path', '/tmp/we"ird/vibeyard'],
      ['trailing separator', '/tmp/vibeyard/'],
      ['non-ascii', '/tmp/\u00fcn\u00efcode/vibeyard'],
    ])('embeds a %s status dir as a valid Python literal', (_label, dir) => {
      // A SyntaxError here is silent in production and kills cost, context,
      // sessionid and name at once. A raw literal breaks on an apostrophe.
      const script = buildStatusLinePython(dir);
      const literal = script.split('\n').find((l) => l.startsWith('status_dir='))!;
      expect(literal).toBe(`status_dir=${JSON.stringify(dir)}`);

      if (!hasPython()) return; // no python3 here

      const result = runPython(
        `import sys,json;ns={};exec(sys.stdin.read(),ns);print(json.dumps(ns["status_dir"]))`,
        literal,
      );
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.toString())).toBe(dir);
    });

    it('writes the name as ASCII-safe JSON', () => {
      // json.dumps defaults to ensure_ascii=True, so a CJK/emoji title never
      // hits Windows' locale codepage and raises UnicodeEncodeError — which
      // would abort the script and take the .cost write down with it.
      expect(body()).toContain('json.dumps(');
      expect(body()).not.toContain("encoding=");
    });

    it('writes .sessionid only when the id changed', () => {
      // The statusLine fires on every render. An unconditional write reaches the
      // renderer as an IPC that ends in a persist plus a full renderLayout(),
      // which used to re-append the terminal pane many times a second — blurring
      // the in-pane find bar and collapsing an in-progress selection.
      if (!hasPython()) return; // no python3 on this runner

      // Real fs, deliberately: `fs` is mocked in this suite, so the script's own
      // writes are observed from inside Python instead.
      const tmp = path.join(
        process.env.TMPDIR || process.env.TEMP || '/tmp',
        `vibeyard-statusline-${process.pid}`,
      );
      const driver = `
import sys,os,io,json,builtins,shutil
src=sys.stdin.read()
d=${JSON.stringify(tmp)}
shutil.rmtree(d,ignore_errors=True)
os.makedirs(d)
writes=[]
real=builtins.open
def spy(file,mode='r',*a,**k):
    if str(file).endswith('.sessionid') and 'w' in mode:
        writes.append(str(file))
    return real(file,mode,*a,**k)
builtins.open=spy
os.environ['CLAUDE_IDE_SESSION_ID']='sess1'
def run(payload):
    sys.stdin=io.StringIO(payload)
    try:
        exec(compile(src,'statusline','exec'),{})
    except SystemExit:
        pass
run('{"session_id":"cli-a"}')
run('{"session_id":"cli-a"}')
after_repeat=len(writes)
run('{"session_id":"cli-b"}')
final=real(os.path.join(d,'sess1.sessionid')).read()
shutil.rmtree(d,ignore_errors=True)
sys.stdout.write(json.dumps({'afterRepeat':after_repeat,'total':len(writes),'final':final}))
`;
      // Built against the temp dir so the script's .cost/.name writes land there too.
      const result = runPython(driver, buildStatusLinePython(tmp));
      expect(result.status).toBe(0);

      const seen = JSON.parse(result.stdout.toString());
      expect(seen.afterRepeat).toBe(1); // the repeat wrote nothing
      expect(seen.total).toBe(2);       // the changed id did
      expect(seen.final).toBe('cli-b');
    });

    it('is syntactically valid Python', () => {
      // A syntax error here is silent in production: it kills cost, context,
      // sessionid and name at once, with the traceback going only to
      // statusline.log. Nothing else in this suite would catch it.
      if (!hasPython()) return; // no python3 on this runner

      const result = runPython('import sys;compile(sys.stdin.read(),"statusline","exec")', body());

      expect(result.stderr.toString()).toBe('');
      expect(result.status).toBe(0);
    });
  });

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

    it('installs the Python body as a file and invokes it by path', () => {
      // Never inlined into the shell command — see the module docstring in
      // hook-commands.ts for why inlining Python here is fragile.
      installStatusLineScript();

      const pyPath = path.join(SCRIPT_DIR, 'statusline.py');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        pyPath,
        expect.stringContaining('session_name'),
        { mode: 0o755 },
      );

      const wrapper = vi.mocked(fs.writeFileSync).mock.calls
        .find(([target]) => target === STATUSLINE_SCRIPT)![1] as string;
      expect(wrapper).toContain(`"${pyPath}"`);
      expect(wrapper).not.toContain('-c');
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

    it('.subagents is hook-internal and never forwarded to the renderer', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      watchCallback!('change', 'abc123.subagents');

      expect(mockSend).not.toHaveBeenCalled();
      // Must not even read the counter file — it is purely a hook-side artifact.
      expect(fs.readFileSync).not.toHaveBeenCalled();
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

    it('.name parses JSON and sends session:sessionName with the CLI session id', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ name: 'Fix the flaky test', session_id: 'cli-1' }),
      );
      watchCallback!('change', 'abc123.name');

      expect(mockSend).toHaveBeenCalledWith('session:sessionName', 'abc123', 'Fix the flaky test', 'cli-1');
    });

    it('.name without a session_id sends an empty CLI session id', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'Untagged' }));
      watchCallback!('change', 'abc123.name');

      expect(mockSend).toHaveBeenCalledWith('session:sessionName', 'abc123', 'Untagged', '');
    });

    it('.name with malformed JSON does not send and does not throw', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      // A partially-flushed write looks exactly like this
      vi.mocked(fs.readFileSync).mockReturnValue('{"name": "Fix the fla');
      expect(() => watchCallback!('change', 'abc123.name')).not.toThrow();

      expect(mockSend).not.toHaveBeenCalledWith('session:sessionName', expect.anything(), expect.anything());
    });

    it('.name with an empty or non-string name does not send', () => {
      const win = createMockWin();
      startWatching(win);
      registerSession('abc123');

      for (const payload of ['{}', '{"name":""}', '{"name":123}']) {
        vi.mocked(fs.readFileSync).mockReturnValue(payload);
        watchCallback!('change', 'abc123.name');
      }

      expect(mockSend).not.toHaveBeenCalledWith('session:sessionName', expect.anything(), expect.anything());
    });

    it('.name is ignored for unregistered sessions', () => {
      const win = createMockWin();
      startWatching(win);

      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'Nope' }));
      watchCallback!('change', 'stranger.name');

      expect(mockSend).not.toHaveBeenCalled();
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
    it('unlinks all 7 file types', () => {
      cleanupSessionStatus('sess-1');

      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.status'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.sessionid'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.cost'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.name'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.toolfailure'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.events'));
      expect(fs.unlinkSync).toHaveBeenCalledWith(path.join(STATUS_DIR, 'sess-1.subagents'));
      expect(fs.unlinkSync).toHaveBeenCalledTimes(7);
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
