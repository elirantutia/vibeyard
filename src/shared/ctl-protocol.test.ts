import { describe, it, expect } from 'vitest';
import { parseCtlRequest, ctlError, CTL_MAX_PROMPT_CHARS } from './ctl-protocol';

const req = (command: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ v: 1, token: 'tok', command, ...extra });

describe('parseCtlRequest', () => {
  it('accepts a full new-session request and keeps strings verbatim', () => {
    const name = 'DR-1 "quoted" $HOME `x` ünï';
    const prompt = 'line1\nline2 "q" $(rm -rf /)';
    const r = parseCtlRequest(req({ action: 'new-session', name, prompt, project: '/p', provider: 'claude', profile: 'work', focus: true }));
    expect(r).toEqual({ ok: true, token: 'tok', command: { action: 'new-session', name, prompt, project: '/p', provider: 'claude', profile: 'work', focus: true } });
  });

  it.each(['args', 'env'])('rejects a new-session carrying %s instead of silently dropping it', (key) => {
    const r = parseCtlRequest(req({ action: 'new-session', name: 'n', [key]: key === 'env' ? 'NODE_OPTIONS=--require x' : '--dangerously-skip-permissions' }));
    expect(r).toEqual({
      ok: false,
      error: { code: 'invalid_request', message: `'${key}' is not supported: new sessions use the project's saved default args and env` },
    });
  });

  it('accepts rename, close and list', () => {
    expect(parseCtlRequest(req({ action: 'rename', sessionId: 's1', name: 'n' }))).toMatchObject({ ok: true, command: { action: 'rename', sessionId: 's1', name: 'n' } });
    expect(parseCtlRequest(req({ action: 'close', sessionId: 's1' }))).toMatchObject({ ok: true, command: { action: 'close', sessionId: 's1' } });
    expect(parseCtlRequest(req({ action: 'list', mine: true }))).toMatchObject({ ok: true, command: { action: 'list', mine: true } });
  });

  it.each([
    ['not json', '{'],
    ['wrong version', JSON.stringify({ v: 2, token: 't', command: { action: 'list' } })],
    ['missing token', JSON.stringify({ v: 1, command: { action: 'list' } })],
    ['unknown action', req({ action: 'send', sessionId: 's' })],
    ['empty name', req({ action: 'new-session', name: '   ' })],
    ['non-string name', req({ action: 'new-session', name: 5 })],
    ['missing sessionId', req({ action: 'close' })],
    ['focus not boolean', req({ action: 'new-session', name: 'n', focus: 'yes' })],
    ['prompt too long', req({ action: 'new-session', name: 'n', prompt: 'x'.repeat(CTL_MAX_PROMPT_CHARS + 1) })],
  ])('rejects %s with invalid_request', (_label, raw) => {
    const r = parseCtlRequest(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid_request');
  });

  it('drops unknown fields instead of passing them through', () => {
    const r = parseCtlRequest(req({ action: 'close', sessionId: 's', evil: 1 }));
    expect(r).toEqual({ ok: true, token: 'tok', command: { action: 'close', sessionId: 's' } });
  });
});

describe('ctlError', () => {
  it('builds the error envelope', () => {
    expect(ctlError('not_owner', 'nope')).toEqual({ ok: false, error: { code: 'not_owner', message: 'nope' } });
  });
});
