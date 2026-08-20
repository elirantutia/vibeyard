import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import * as fs from 'fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { stopStatusCmd, installHookScripts, STOP_STALE_MS } from './hook-commands';
import { pythonBin } from './platform';

// `fs` is mocked module-wide above; the executed-script suite below needs the
// real thing to stage a temp dir and read back what the hook wrote.
const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');

// Resolved at collection time so describe.runIf can see it — a CI image without
// a usable python should skip these, not fail them.
const pythonAvailable = spawnSync(pythonBin, ['-c', 'pass']).status === 0;

const HOOK_MARKER = '# vibeyard-hook';

/**
 * Source of a script that installHookScripts() wrote, by filename.
 *
 * installHookScripts() is guarded by a module-level `scriptsInstalled` flag, so
 * only the first call actually writes. That's fine because the fs mock's call
 * list accumulates for the lifetime of the module — but it does mean this
 * helper would break if a global `clearMocks` were ever turned on in
 * vitest.config.ts.
 */
function installedScript(name: string): string {
  installHookScripts();
  const writes = vi.mocked(fs.writeFileSync).mock.calls.map(([p, code]) => [String(p), String(code)] as const);
  const hit = writes.find(([p]) => p.endsWith(name));
  expect(hit, `${name} was not installed`).toBeDefined();
  return hit![1];
}

describe('stopStatusCmd', () => {
  it('builds a python command invoking stop_status_writer.py with the expected argv', () => {
    const cmd = stopStatusCmd('CLAUDE_IDE_SESSION_ID', HOOK_MARKER);

    expect(cmd).toContain('stop_status_writer.py');
    expect(cmd).toContain('CLAUDE_IDE_SESSION_ID');
    expect(cmd).toContain('vibeyard'); // STATUS_DIR path segment
    expect(cmd).toContain(String(STOP_STALE_MS));
    // Marker is passed as the last quoted argv so isIdeHook recognizes it.
    expect(cmd.trimEnd().endsWith(`"${HOOK_MARKER}"`)).toBe(true);
  });

  it('defaults the staleness window to 10 minutes', () => {
    expect(STOP_STALE_MS).toBe(600000);
  });
});

describe('installHookScripts', () => {
  it('installs a background-task-aware stop_status_writer.py', () => {
    const body = installedScript('stop_status_writer.py');

    // Prefers the Stop payload's own in-flight report...
    expect(body).toContain('background_tasks');
    expect(body).toContain('isinstance(bt,list)');
    // ...and keeps the legacy counter as the absent-key fallback.
    expect(body).toContain('.subagents');
    expect(body).toContain("'Stop:'+status");
    // Belt-and-suspenders against a mislabeled subagent stop.
    expect(body).toContain("hook_event_name')=='SubagentStop'");
    // A /loop session always has a pending cron; consulting it would mean the
    // session never reports completed.
    expect(body).not.toContain('session_crons');
  });

  it('skips a user-abort failure in tool_failure_capture.py', () => {
    const body = installedScript('tool_failure_capture.py');

    expect(body).toContain("not d.get('is_interrupt')");
    // An empty error can never match either detector, so don't write the file.
    expect(body).toContain('and err and');
  });
});

// The Stop writer's decision table is the load-bearing part of completion
// detection, and asserting on its source text can't tell a correct branch from
// a typo'd one. Run the real script the way Claude Code does: payload on stdin,
// assert the .status file it leaves behind.
describe.runIf(pythonAvailable)('stop_status_writer.py behaviour', () => {
  const SID = 'vibeyard-test-session';
  let dir: string;
  let script: string;

  // Staged in beforeAll, not the describe body: Vitest executes the body even
  // for a skipped suite, but not its hooks — so building the temp dir inline
  // would leak one directory per run on a CI image without python.
  beforeAll(() => {
    dir = realFs.mkdtempSync(path.join(os.tmpdir(), 'vibeyard-stop-'));
    script = path.join(dir, 'stop_status_writer.py');
    realFs.writeFileSync(script, installedScript('stop_status_writer.py'));
  });

  afterAll(() => {
    if (dir) realFs.rmSync(dir, { recursive: true, force: true });
  });

  /** Run the writer with `payload` on stdin and return the status it wrote. */
  function run(payload: unknown, counter?: { n: number; t: number }): string {
    const counterPath = path.join(dir, `${SID}.subagents`);
    realFs.rmSync(counterPath, { force: true });
    if (counter) realFs.writeFileSync(counterPath, JSON.stringify(counter));

    const statusPath = path.join(dir, `${SID}.status`);
    realFs.rmSync(statusPath, { force: true });

    const res = spawnSync(pythonBin, [script, 'CLAUDE_IDE_SESSION_ID', dir, String(STOP_STALE_MS)], {
      input: JSON.stringify(payload),
      env: { ...process.env, CLAUDE_IDE_SESSION_ID: SID },
      encoding: 'utf8',
    });
    expect(res.status, res.stderr).toBe(0);
    return realFs.readFileSync(statusPath, 'utf8');
  }

  const base = { hook_event_name: 'Stop', session_id: 'abc' };
  const fresh = () => ({ n: 1, t: Date.now() });

  it('completes when the payload and the counter both report nothing in flight', () => {
    expect(run({ ...base, background_tasks: [], session_crons: [] })).toBe('Stop:completed');
  });

  it('holds working while a subagent is in flight', () => {
    const bt = [{ id: '1', type: 'subagent', status: 'running', agent_type: 'Explore' }];
    expect(run({ ...base, background_tasks: bt })).toBe('Stop:working');
  });

  it('holds working for teammate and workflow tasks too', () => {
    for (const type of ['teammate', 'workflow']) {
      expect(run({ ...base, background_tasks: [{ id: '1', type, status: 'running' }] })).toBe('Stop:working');
    }
  });

  it('completes despite a backgrounded shell — the turn is over', () => {
    const bt = [{ id: '1', type: 'shell', status: 'running', command: 'tail -f log' }];
    expect(run({ ...base, background_tasks: bt })).toBe('Stop:completed');
  });

  it('ignores a subagent already in a terminal state', () => {
    const bt = [{ id: '1', type: 'subagent', status: 'completed' }];
    expect(run({ ...base, background_tasks: bt })).toBe('Stop:completed');
  });

  it('completes with a pending cron so a /loop session is not wedged', () => {
    const crons = [{ id: 'c1', schedule: '0 9 * * *', recurring: true, prompt: 'check' }];
    expect(run({ ...base, background_tasks: [], session_crons: crons })).toBe('Stop:completed');
  });

  // An empty array means "nothing in flight"; an absent key means the CLI is
  // too old (or the registry is unreachable) and the counter must decide.
  it('falls back to the counter when background_tasks is absent', () => {
    expect(run(base, fresh())).toBe('Stop:working');
    expect(run(base, { n: 0, t: Date.now() })).toBe('Stop:completed');
    // A stale count must not wedge the session forever.
    expect(run(base, { n: 1, t: Date.now() - STOP_STALE_MS - 1000 })).toBe('Stop:completed');
  });

  // An empty array is NOT proof of an idle session: the CLI filters the list on
  // an isBackgrounded flag that freshly-dispatched foreground subagents don't
  // carry yet, so a spurious Stop can report [] with subagents still running.
  // Falling back to the counter costs at most a late notification (bounded by
  // the renderer backstop); trusting [] fires a completion mid-orchestration.
  it('does not treat an empty background_tasks as proof the session is idle', () => {
    expect(run({ ...base, background_tasks: [] }, fresh())).toBe('Stop:working');
  });

  it('still completes on an empty background_tasks once the counter agrees', () => {
    expect(run({ ...base, background_tasks: [] }, { n: 0, t: Date.now() })).toBe('Stop:completed');
  });

  it('never completes the parent for a Stop fired inside a subagent', () => {
    expect(run({ ...base, background_tasks: [], agent_id: 'a1', agent_type: 'Explore' })).toBe('Stop:working');
    expect(run({ ...base, hook_event_name: 'SubagentStop', background_tasks: [] })).toBe('Stop:working');
  });

  // agent_type is also set on the MAIN thread of a `--claude --agent x` session
  // (agent_id is not), so keying on it would wedge such a session in 'working'
  // until the 10-minute renderer backstop fired.
  it('completes a --agent session, where agent_type is set without agent_id', () => {
    expect(run({ ...base, background_tasks: [], agent_type: 'reviewer' })).toBe('Stop:completed');
  });

  it('completes on a malformed payload rather than hanging', () => {
    const statusPath = path.join(dir, `${SID}.status`);
    realFs.rmSync(statusPath, { force: true });
    realFs.rmSync(path.join(dir, `${SID}.subagents`), { force: true });
    const res = spawnSync(pythonBin, [script, 'CLAUDE_IDE_SESSION_ID', dir, String(STOP_STALE_MS)], {
      input: 'not json at all',
      env: { ...process.env, CLAUDE_IDE_SESSION_ID: SID },
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    expect(realFs.readFileSync(statusPath, 'utf8')).toBe('Stop:completed');
  });
});
