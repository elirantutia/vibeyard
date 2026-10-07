import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCtlCommand, toCtlStatus, type CtlHandlerDeps } from './ctl-handler';
import type { ProjectRecord, SessionRecord } from '../shared/types';

function session(id: string, extra: Partial<SessionRecord> = {}): SessionRecord {
  return { id, name: id, cliSessionId: null, createdAt: '2026-10-07T00:00:00Z', ...extra } as SessionRecord;
}

let projects: ProjectRecord[];
let deps: CtlHandlerDeps;
let hook: Record<string, string>;
let term: Record<string, { spawned: boolean; exited: boolean }>;

beforeEach(() => {
  hook = {};
  term = {};
  projects = [
    { id: 'p1', name: 'P1', path: '/repo/one', sessions: [session('tl'), session('w1', { createdBy: 'tl', cost: { totalCostUsd: 1.5 } as any }), session('mine-human')] } as unknown as ProjectRecord,
    { id: 'p2', name: 'P2', path: '/repo/two', sessions: [session('other'), session('kanban', { type: 'kanban' } as any)] } as unknown as ProjectRecord,
  ];
  deps = {
    projects: () => projects,
    addExternalSession: vi.fn((projectId, opts) => {
      const s = session('new-1', { name: opts.name, createdBy: opts.createdBy, userRenamed: true });
      projects.find((p) => p.id === projectId)!.sessions.push(s);
      return s;
    }),
    renameSession: vi.fn((_p: string, id: string, name: string) => {
      const s = projects.flatMap((p) => p.sessions).find((x) => x.id === id);
      if (s) s.name = name;
    }),
    closeSessionWithConfirm: vi.fn(),
    needsCloseConfirmation: vi.fn((id: string) => hook[id] === 'working'),
    hookStatus: (id) => hook[id] ?? 'idle',
    terminalState: (id) => term[id],
    isKnownProvider: (id) => ['claude', 'codex', 'copilot', 'gemini'].includes(id),
    invalidEnvLines: (env) => env.split('\n').filter((l) => l && !l.includes('=')),
    effectiveProvider: (requested) => requested ?? 'claude',
    profileProvider: (id) => ({ work: 'claude', cx: 'codex' } as Record<string, string>)[id],
  };
});

describe('new-session', () => {
  it("defaults to the caller's project and passes options through verbatim", () => {
    const r = handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'DR-1 "x"', prompt: 'a\nb', args: '--model sonnet', focus: true });
    expect(r).toEqual({ ok: true, result: { sessionId: 'new-1', projectId: 'p1', name: 'DR-1 "x"' } });
    expect(deps.addExternalSession).toHaveBeenCalledWith('p1', { name: 'DR-1 "x"', initialPrompt: 'a\nb', args: '--model sonnet', envVars: undefined, providerId: undefined, profileId: undefined, createdBy: 'tl', focus: true });
  });

  it('resolves --project by id or by path (trailing slash tolerated)', () => {
    handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', project: 'p2' });
    handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', project: '/repo/two/' });
    expect(vi.mocked(deps.addExternalSession).mock.calls.map((c) => c[0])).toEqual(['p2', 'p2']);
  });

  it('returns unknown_project for an unknown project and invalid_request for a bad provider or env', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', project: '/nope' })).toMatchObject({ ok: false, error: { code: 'unknown_project' } });
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', provider: 'gpt' })).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', env: 'NOEQUALS' })).toMatchObject({ ok: false, error: { code: 'invalid_request' } });
  });

  it("returns invalid_request \"unknown profile '<id>'\" for a profile that does not exist, and creates nothing", () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', profile: 'nope' })).toEqual({ ok: false, error: { code: 'invalid_request', message: "unknown profile 'nope'" } });
    expect(deps.addExternalSession).not.toHaveBeenCalled();
  });

  it("rejects (a) a non-default-provider profile with no --provider, naming the fix, and creates nothing", () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', profile: 'cx' })).toEqual({ ok: false, error: { code: 'invalid_request', message: "profile 'cx' is for provider 'codex', not 'claude'; pass --provider codex" } });
    expect(deps.addExternalSession).not.toHaveBeenCalled();
  });

  it('rejects a profile whose provider differs from an explicit --provider', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', provider: 'claude', profile: 'cx' })).toEqual({ ok: false, error: { code: 'invalid_request', message: "profile 'cx' is for provider 'codex', not 'claude'; pass --provider codex" } });
    expect(deps.addExternalSession).not.toHaveBeenCalled();
  });

  it('(b) accepts the same profile with a matching --provider', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', provider: 'codex', profile: 'cx' })).toMatchObject({ ok: true });
    expect(vi.mocked(deps.addExternalSession).mock.calls[0][1]).toMatchObject({ providerId: 'codex', profileId: 'cx' });
  });

  it('(c) accepts a profile of the default provider with no --provider', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', profile: 'work' })).toMatchObject({ ok: true });
    expect(vi.mocked(deps.addExternalSession).mock.calls[0][1]).toMatchObject({ profileId: 'work' });
  });

  it("(d) reports an unknown profile as \"unknown profile\" even with a provider", () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'new-session', name: 'n', provider: 'codex', profile: 'nope' })).toEqual({ ok: false, error: { code: 'invalid_request', message: "unknown profile 'nope'" } });
  });

  it('returns unknown_project when the caller no longer exists and no project is given', () => {
    expect(handleCtlCommand(deps, 'ghost', { action: 'new-session', name: 'n' })).toMatchObject({ ok: false, error: { code: 'unknown_project' } });
  });
});

describe('rename', () => {
  it('renames self and owned sessions with userRenamed=true', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'rename', sessionId: 'w1', name: 'done' })).toEqual({ ok: true, result: { sessionId: 'w1', name: 'done' } });
    expect(handleCtlCommand(deps, 'tl', { action: 'rename', sessionId: 'tl', name: 'TL' }).ok).toBe(true);
    expect(deps.renameSession).toHaveBeenCalledWith('p1', 'w1', 'done', true);
  });

  it('refuses tabs the caller did not create', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'rename', sessionId: 'mine-human', name: 'x' })).toMatchObject({ ok: false, error: { code: 'not_owner' } });
    expect(deps.renameSession).not.toHaveBeenCalled();
  });

  it('returns unknown_session and unsupported where appropriate', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'rename', sessionId: 'nope', name: 'x' })).toMatchObject({ ok: false, error: { code: 'unknown_session' } });
    projects[1].sessions[1].createdBy = 'tl';
    expect(handleCtlCommand(deps, 'tl', { action: 'rename', sessionId: 'kanban', name: 'x' })).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  });
});

describe('close', () => {
  it('closes an idle owned tab immediately', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'close', sessionId: 'w1' })).toEqual({ ok: true, result: { state: 'closed' } });
    expect(deps.closeSessionWithConfirm).toHaveBeenCalledWith('p1', 'w1');
  });

  it('routes an active tab through the confirmation dialog and reports awaiting_confirmation', () => {
    hook.w1 = 'working';
    expect(handleCtlCommand(deps, 'tl', { action: 'close', sessionId: 'w1' })).toEqual({ ok: true, result: { state: 'awaiting_confirmation' } });
    expect(deps.closeSessionWithConfirm).toHaveBeenCalledWith('p1', 'w1');
  });

  it('closes a never-started tab without a dialog', () => {
    // no hook status, no terminal instance
    expect(handleCtlCommand(deps, 'tl', { action: 'close', sessionId: 'w1' })).toEqual({ ok: true, result: { state: 'closed' } });
  });

  it('refuses tabs the caller did not create and unknown ids', () => {
    expect(handleCtlCommand(deps, 'tl', { action: 'close', sessionId: 'other' })).toMatchObject({ ok: false, error: { code: 'not_owner' } });
    expect(handleCtlCommand(deps, 'tl', { action: 'close', sessionId: 'gone' })).toMatchObject({ ok: false, error: { code: 'unknown_session' } });
    expect(deps.closeSessionWithConfirm).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  it('lists CLI sessions across projects with status, owner and cost', () => {
    term.tl = { spawned: true, exited: false };
    hook.tl = 'working';
    term.w1 = { spawned: true, exited: true };
    const r = handleCtlCommand(deps, 'tl', { action: 'list' });
    expect(r.ok).toBe(true);
    const rows = (r as { result: any[] }).result;
    expect(rows.map((x) => x.sessionId)).toEqual(['tl', 'w1', 'mine-human', 'other']); // kanban excluded
    expect(rows[0]).toMatchObject({ projectId: 'p1', status: 'working', createdBy: null, providerId: 'claude' });
    expect(rows[1]).toMatchObject({ status: 'exited', createdBy: 'tl', cost: { totalCostUsd: 1.5 } });
    expect(rows[2]).toMatchObject({ status: 'not_started', cost: null });
  });

  it('filters with --mine and --project', () => {
    const mine = handleCtlCommand(deps, 'tl', { action: 'list', mine: true }) as { result: any[] };
    expect(mine.result.map((x) => x.sessionId)).toEqual(['w1']);
    const p2 = handleCtlCommand(deps, 'tl', { action: 'list', project: '/repo/two' }) as { result: any[] };
    expect(p2.result.map((x) => x.sessionId)).toEqual(['other']);
  });
});

describe('toCtlStatus', () => {
  it.each([
    ['working', { spawned: true, exited: false }, 'working'],
    ['input', { spawned: true, exited: false }, 'input'],
    ['waiting', { spawned: true, exited: false }, 'idle'],
    ['completed', { spawned: true, exited: false }, 'idle'],
    ['working', { spawned: true, exited: true }, 'exited'],
    ['idle', undefined, 'not_started'],
    ['idle', { spawned: false, exited: false }, 'not_started'],
  ])('%s + %o → %s', (h, t, expected) => {
    expect(toCtlStatus(h, t as any)).toBe(expected);
  });
});
