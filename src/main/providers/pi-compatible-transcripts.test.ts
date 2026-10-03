import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  sessionHeaderFromWindow,
  transcriptTitleFromWindow,
  transcriptStatusFromTail,
  readTranscriptStatusSync,
  sessionExitReasonFromTail,
  readSessionExitReasonSync,
  TAIL_READ_BYTES,
} from './pi-compatible-transcripts';

const header = (id: string, cwd: string, title?: string) =>
  JSON.stringify({
    type: 'session',
    version: 3,
    id,
    timestamp: 't',
    cwd,
    ...(title !== undefined ? { title, titleSource: 'auto' } : {}),
  });

const titleEntry = (title: string) =>
  JSON.stringify({ type: 'title', v: 1, title, source: 'auto', updatedAt: 't' });

describe('sessionHeaderFromWindow', () => {
  it('finds the header on line 1 (Pi layout, no title line)', () => {
    const h = sessionHeaderFromWindow(header('pi-1', '/proj'));
    expect(h?.id).toBe('pi-1');
    expect(h?.cwd).toBe('/proj');
  });

  it('finds the header when a title line precedes it (OMP layout)', () => {
    const window = [titleEntry('Some title'), header('omp-1', '/proj')].join('\n');
    const h = sessionHeaderFromWindow(window);
    expect(h?.id).toBe('omp-1');
    expect(h?.cwd).toBe('/proj');
  });

  it('returns null for a null or non-JSON window', () => {
    expect(sessionHeaderFromWindow(null)).toBeNull();
    expect(sessionHeaderFromWindow('not json at all')).toBeNull();
  });

  it('ignores non-session entries before the header', () => {
    const window = ['{"type":"model_change","id":"m1"}', header('omp-2', '/proj')].join('\n');
    expect(sessionHeaderFromWindow(window)?.id).toBe('omp-2');
  });
});

describe('transcriptTitleFromWindow', () => {
  it('reads the title from the type:"title" entry', () => {
    const window = [titleEntry('Per-Provider Default Profile Migration'), header('omp-1', '/proj')].join('\n');
    expect(transcriptTitleFromWindow(window)).toBe('Per-Provider Default Profile Migration');
  });

  it('prefers the title entry over the header title field', () => {
    const window = [titleEntry('Entry title'), header('omp-1', '/proj', 'Header title')].join('\n');
    expect(transcriptTitleFromWindow(window)).toBe('Entry title');
  });

  it('falls back to the header title field when no title entry exists', () => {
    expect(transcriptTitleFromWindow(header('omp-1', '/proj', 'Header title'))).toBe('Header title');
  });

  it('returns null for transcripts without any title (Pi)', () => {
    expect(transcriptTitleFromWindow(header('pi-1', '/proj'))).toBeNull();
  });

  it('returns null for a blank title', () => {
    expect(transcriptTitleFromWindow([titleEntry('   '), header('omp-1', '/proj')].join('\n'))).toBeNull();
  });

  it('trims surrounding whitespace from the title', () => {
    expect(transcriptTitleFromWindow(titleEntry('  Padded title  '))).toBe('Padded title');
  });
});

const assistant = (stopReason: string) =>
  JSON.stringify({ type: 'message', message: { role: 'assistant', stopReason } });
const userMsg = () => JSON.stringify({ type: 'message', message: { role: 'user' } });
const toolResult = () => JSON.stringify({ type: 'message', message: { role: 'toolResult' } });
const toolStart = () => JSON.stringify({ type: 'custom', customType: 'tool_execution_start' });
const sessionExit = () => JSON.stringify({ type: 'custom', customType: 'session_exit' });

describe('transcriptStatusFromTail', () => {
  it('maps a clean assistant finish (stop) to completed', () => {
    expect(transcriptStatusFromTail(assistant('stop'))).toBe('completed');
  });

  it('maps an assistant turn stopped on a tool call to working', () => {
    expect(transcriptStatusFromTail(assistant('toolUse'))).toBe('working');
  });

  it('maps an assistant turn that errored to waiting (back at prompt)', () => {
    expect(transcriptStatusFromTail(assistant('error'))).toBe('waiting');
  });

  it('maps a user message to working (CLI processing)', () => {
    expect(transcriptStatusFromTail(userMsg())).toBe('working');
  });

  it('maps a toolResult to working (assistant continues)', () => {
    expect(transcriptStatusFromTail(toolResult())).toBe('working');
  });

  it('maps a tool_execution_start marker to working', () => {
    expect(transcriptStatusFromTail(toolStart())).toBe('working');
  });

  it('maps session_exit to null (session removed on PTY exit)', () => {
    expect(transcriptStatusFromTail(sessionExit())).toBeNull();
    expect(transcriptStatusFromTail([assistant('toolUse'), sessionExit()].join('\n'))).toBeNull();
  });

  it('skips non-event lines and uses the last meaningful entry', () => {
    const tail = [
      assistant('stop'),
      titleEntry('A title'),
      '{"type":"model_change","id":"m"}',
    ].join('\n');
    expect(transcriptStatusFromTail(tail)).toBe('completed');
  });

  it('skips a mid-write tail line and keeps scanning backwards', () => {
    const tail = [assistant('toolUse'), '{"type":"message","message":{"role":"assistant","st'].join('\n');
    expect(transcriptStatusFromTail(tail)).toBe('working');
  });

  it('returns null for a null or non-JSON tail', () => {
    expect(transcriptStatusFromTail(null)).toBeNull();
    expect(transcriptStatusFromTail('not json at all')).toBeNull();
  });

  it('returns null when only non-event entries are present', () => {
    const tail = [titleEntry('t'), '{"type":"model_change","id":"m"}'].join('\n');
    expect(transcriptStatusFromTail(tail)).toBeNull();
  });
});

describe('readTranscriptStatusSync huge-entry fallback', () => {
  it('captures the status of a final entry larger than the tail window', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-tail-'));
    try {
      const file = path.join(dir, 't.jsonl');
      const big = 'x'.repeat(TAIL_READ_BYTES + 4096);
      const hugeEntry = JSON.stringify({
        type: 'message',
        message: { role: 'assistant', stopReason: 'stop', content: big },
      });
      expect(hugeEntry.length).toBeGreaterThan(TAIL_READ_BYTES);
      const content = [
        header('s1', '/proj'),
        JSON.stringify({ type: 'message', message: { role: 'user', content: 'go' } }),
        hugeEntry,
      ].join('\n') + '\n';
      fs.writeFileSync(file, content);
      // The 16KB window lands entirely inside the huge final entry (no
      // complete line); the bounded fallback read must still surface its
      // status instead of leaving the poller on a stale value.
      expect(readTranscriptStatusSync(file)).toBe('completed');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const sessionExitWith = (data: Record<string, unknown>) =>
  JSON.stringify({ type: 'custom', customType: 'session_exit', data });

describe('sessionExitReasonFromTail', () => {
  it('preserves the exit marker timestamp for launch-time correlation', () => {
    const marker = JSON.stringify({ type: 'custom', customType: 'session_exit', timestamp: '2026-10-03T10:00:00.000Z', data: { reason: 'sighup', kind: 'signal' } });
    expect(sessionExitReasonFromTail(marker)).toEqual({ reason: 'sighup', kind: 'signal', timestamp: '2026-10-03T10:00:00.000Z' });
  });
  it('extracts reason and kind from a trailing session_exit', () => {
    const tail = [
      assistant('toolUse'),
      sessionExitWith({
        reason: 'unhandled_rejection',
        kind: 'fatal',
        pendingToolCalls: [{ tool: 'bash', callId: 'c1' }],
      }),
    ].join('\n');
    expect(sessionExitReasonFromTail(tail)).toEqual({ reason: 'unhandled_rejection', kind: 'fatal' });
  });

  it('falls back to unknown when the session_exit has no data', () => {
    expect(sessionExitReasonFromTail(sessionExit())).toEqual({ reason: 'unknown' });
  });

  it('falls back to unknown for a missing reason and omits an absent kind', () => {
    expect(sessionExitReasonFromTail(sessionExitWith({ kind: 'fatal' }))).toEqual({ reason: 'unknown', kind: 'fatal' });
    expect(sessionExitReasonFromTail(sessionExitWith({ reason: 'oom' }))).toEqual({ reason: 'oom' });
  });

  it('returns null when the last parseable line is not a session_exit', () => {
    const tail = [sessionExit(), assistant('stop')].join('\n');
    expect(sessionExitReasonFromTail(tail)).toBeNull();
  });

  it('returns null when there is no session_exit at all', () => {
    expect(sessionExitReasonFromTail(assistant('stop'))).toBeNull();
    expect(sessionExitReasonFromTail(null)).toBeNull();
    expect(sessionExitReasonFromTail('not json at all')).toBeNull();
  });

  it('skips a mid-write tail line and uses the last complete line', () => {
    const tail = [sessionExitWith({ reason: 'oom' }), '{"type":"custom","customType":"sess'].join('\n');
    expect(sessionExitReasonFromTail(tail)).toEqual({ reason: 'oom' });
  });
});

describe('readSessionExitReasonSync', () => {
  it('reads the reason from a transcript ending in session_exit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-exit-'));
    try {
      const file = path.join(dir, 't.jsonl');
      const content = [
        header('s1', '/proj'),
        assistant('stop'),
        sessionExitWith({ reason: 'unhandled_rejection', kind: 'fatal' }),
      ].join('\n') + '\n';
      fs.writeFileSync(file, content);
      expect(readSessionExitReasonSync(file)).toEqual({ reason: 'unhandled_rejection', kind: 'fatal' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a missing file and for a transcript without session_exit', () => {
    expect(readSessionExitReasonSync(path.join(os.tmpdir(), 'vb-no-such-transcript.jsonl'))).toBeNull();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-exit-'));
    try {
      const file = path.join(dir, 't.jsonl');
      fs.writeFileSync(file, [header('s1', '/proj'), assistant('stop')].join('\n') + '\n');
      expect(readSessionExitReasonSync(file)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('captures a session_exit whose final line is larger than the tail window', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-exit-'));
    try {
      const file = path.join(dir, 't.jsonl');
      const hugeExit = JSON.stringify({
        type: 'custom',
        customType: 'session_exit',
        data: {
          reason: 'unhandled_rejection',
          kind: 'fatal',
          pendingToolCalls: 'x'.repeat(TAIL_READ_BYTES + 4096),
        },
      });
      expect(hugeExit.length).toBeGreaterThan(TAIL_READ_BYTES);
      const content = [header('s1', '/proj'), assistant('stop'), hugeExit].join('\n') + '\n';
      fs.writeFileSync(file, content);
      // The 16KB window lands entirely inside the huge final line (no
      // complete line to parse); the bounded fallback read must still
      // surface the reason.
      expect(readSessionExitReasonSync(file)).toEqual({ reason: 'unhandled_rejection', kind: 'fatal' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
