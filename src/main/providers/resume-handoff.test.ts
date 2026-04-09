import { describe, it, expect } from 'vitest';
import { buildHandoffPrompt } from './resume-handoff';

describe('buildHandoffPrompt', () => {
  it('includes the transcript path when one is provided', () => {
    const out = buildHandoffPrompt({
      fromProviderLabel: 'Claude Code',
      sessionName: 'refactor auth',
      transcriptPath: '/home/u/.claude/projects/abc/xyz.jsonl',
    });
    expect(out).toContain('Claude Code');
    expect(out).toContain('"refactor auth"');
    expect(out).toContain('/home/u/.claude/projects/abc/xyz.jsonl');
    expect(out).toContain('read-only history');
    expect(out).toContain('Do not re-execute tool calls');
  });

  it('falls back to a no-transcript prompt when path is null', () => {
    const out = buildHandoffPrompt({
      fromProviderLabel: 'Codex CLI',
      sessionName: 'fix login',
      transcriptPath: null,
    });
    expect(out).toContain('Codex CLI');
    expect(out).toContain('No prior transcript file is available');
    expect(out).not.toContain('read-only history');
  });

  it('strips control characters from the session name', () => {
    const out = buildHandoffPrompt({
      fromProviderLabel: 'Claude Code',
      sessionName: 'evil\x00name\x07 with more',
      transcriptPath: null,
    });
    expect(out).not.toContain('\x00');
    expect(out).not.toContain('\x07');
    expect(out).toContain('"evilname with more"');
  });

  it('caps very long session names', () => {
    const longName = 'x'.repeat(500);
    const out = buildHandoffPrompt({
      fromProviderLabel: 'Claude Code',
      sessionName: longName,
      transcriptPath: null,
    });
    const quoted = out.match(/"(x+)"/);
    expect(quoted).not.toBeNull();
    expect(quoted![1].length).toBe(200);
  });

  it('falls back to "session" when sanitized name is empty', () => {
    const out = buildHandoffPrompt({
      fromProviderLabel: 'Claude Code',
      sessionName: '\x00\x01\x02',
      transcriptPath: null,
    });
    expect(out).toContain('"session"');
  });
});
