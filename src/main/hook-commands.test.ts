import { describe, it, expect, vi } from 'vitest';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import * as fs from 'fs';
import { stopStatusCmd, installHookScripts, STOP_STALE_MS } from './hook-commands';

const HOOK_MARKER = '# vibeyard-hook';

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
  it('installs a subagent-aware stop_status_writer.py that gates on the counter', () => {
    installHookScripts();

    const writes = vi.mocked(fs.writeFileSync).mock.calls.map(([p, code]) => [String(p), String(code)] as const);
    const stopWriter = writes.find(([p]) => p.endsWith('stop_status_writer.py'));
    expect(stopWriter).toBeDefined();

    const body = stopWriter![1];
    // Reads the in-flight counter and only completes when none are in flight.
    expect(body).toContain('.subagents');
    expect(body).toContain('inflight=n>0');
    expect(body).toContain("'Stop:'+status");
    // Belt-and-suspenders against a mislabeled subagent stop.
    expect(body).toContain("hook_event_name')=='SubagentStop'");
  });
});
