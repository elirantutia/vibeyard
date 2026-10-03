import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../session-cost.js', () => ({
  getCost: vi.fn().mockReturnValue(null),
}));

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

import { archiveSession, buildResumedSession, buildResumedSessionFromCliId } from './session-archive';
import type { ProjectRecord, SessionRecord } from '../../shared/types';

beforeEach(() => {
  uuidCounter = 0;
});

function makeProject(): ProjectRecord {
  return {
    id: 'p1',
    name: 'P',
    path: '/tmp/p',
    sessions: [],
    activeSessionId: null,
    layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
  };
}

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    name: 'Session 1',
    providerId: 'claude',
    cliSessionId: 'cli-1',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('buildResumedSessionFromCliId()', () => {
  it('creates a SessionRecord with the given cliSessionId', () => {
    const session = buildResumedSessionFromCliId('cli-abc-123', 'My Session');
    expect(session.cliSessionId).toBe('cli-abc-123');
    expect(session.name).toBe('My Session');
  });

  it('defaults providerId to claude', () => {
    const session = buildResumedSessionFromCliId('cli-xyz', 'Test');
    expect(session.providerId).toBe('claude');
  });

  it('accepts an explicit providerId', () => {
    const session = buildResumedSessionFromCliId('cli-xyz', 'Test', 'codex');
    expect(session.providerId).toBe('codex');
  });

  it('generates a unique id each call', () => {
    const a = buildResumedSessionFromCliId('cli-1', 'A');
    const b = buildResumedSessionFromCliId('cli-2', 'B');
    expect(a.id).not.toBe(b.id);
  });

  it('sets createdAt to a valid ISO timestamp', () => {
    const before = new Date().toISOString();
    const session = buildResumedSessionFromCliId('cli-t', 'T');
    const after = new Date().toISOString();
    expect(session.createdAt >= before).toBe(true);
    expect(session.createdAt <= after).toBe(true);
  });

  it('does not set type field (plain CLI session)', () => {
    const session = buildResumedSessionFromCliId('cli-t', 'T');
    expect((session as Record<string, unknown>).type).toBeUndefined();
  });
});

describe('teamMemberId propagation', () => {
  it('archiveSession copies teamMemberId from session into the archive entry', () => {
    const project = makeProject();
    archiveSession(project, makeSession({ teamMemberId: 'member-42' }));
    expect(project.sessionHistory).toHaveLength(1);
    expect(project.sessionHistory![0].teamMemberId).toBe('member-42');
  });

  it('archiveSession leaves teamMemberId undefined when the session has none', () => {
    const project = makeProject();
    archiveSession(project, makeSession());
    expect(project.sessionHistory![0].teamMemberId).toBeUndefined();
  });

  it('archiveSession backfills teamMemberId on existing entry sharing cliSessionId', () => {
    const project = makeProject();
    archiveSession(project, makeSession({ cliSessionId: 'cli-share' }));
    expect(project.sessionHistory![0].teamMemberId).toBeUndefined();
    archiveSession(project, makeSession({ cliSessionId: 'cli-share', teamMemberId: 'member-7' }));
    expect(project.sessionHistory).toHaveLength(1);
    expect(project.sessionHistory![0].teamMemberId).toBe('member-7');
  });

  it('buildResumedSession carries teamMemberId forward', () => {
    const session = buildResumedSession({
      id: 'a1',
      name: 'Old',
      providerId: 'claude',
      cliSessionId: 'cli-9',
      createdAt: new Date().toISOString(),
      closedAt: new Date().toISOString(),
      teamMemberId: 'member-99',
      cost: null,
    });
    expect(session.teamMemberId).toBe('member-99');
  });
});

describe('exitReason', () => {
  it('keeps process details for a crashed session', () => {
    const project = makeProject();
    archiveSession(project, makeSession(), { exitReason: 'unhandled_rejection', exitCode: 1, exitSignal: 9, processId: 2028 });
    expect(project.sessionHistory?.[0]).toMatchObject({ exitReason: 'unhandled_rejection', exitCode: 1, exitSignal: 9, processId: 2028 });
  });
  it('keeps a crash entry even when its transcript is unavailable', () => {
    const project = makeProject();
    archiveSession(project, makeSession({ cliSessionId: null }), { exitReason: 'unhandled_rejection', exitCode: 1, processId: 2028, transcriptAvailable: false });
    expect(project.sessionHistory?.[0]).toMatchObject({ exitReason: 'unhandled_rejection', transcriptAvailable: false, processId: 2028 });
  });
  it('archiveSession sets exitReason on the new entry when provided', () => {
    const project = makeProject();
    archiveSession(project, makeSession(), { exitReason: 'unhandled_rejection' });
    expect(project.sessionHistory).toHaveLength(1);
    expect(project.sessionHistory![0].exitReason).toBe('unhandled_rejection');
  });

  it('archiveSession leaves exitReason undefined when opts are absent', () => {
    const project = makeProject();
    archiveSession(project, makeSession());
    expect(project.sessionHistory![0].exitReason).toBeUndefined();
  });

  it('re-archiving with a reason updates the existing entry in place', () => {
    const project = makeProject();
    archiveSession(project, makeSession({ cliSessionId: 'cli-crash' }));
    expect(project.sessionHistory![0].exitReason).toBeUndefined();
    archiveSession(project, makeSession({ cliSessionId: 'cli-crash' }), { exitReason: 'unhandled_rejection' });
    expect(project.sessionHistory).toHaveLength(1);
    expect(project.sessionHistory![0].exitReason).toBe('unhandled_rejection');
  });

  it('re-archiving without a reason does not clear an existing exitReason', () => {
    const project = makeProject();
    archiveSession(project, makeSession({ cliSessionId: 'cli-crash' }), { exitReason: 'unhandled_rejection' });
    archiveSession(project, makeSession({ cliSessionId: 'cli-crash' }));
    expect(project.sessionHistory).toHaveLength(1);
    expect(project.sessionHistory![0].exitReason).toBe('unhandled_rejection');
  });
});
