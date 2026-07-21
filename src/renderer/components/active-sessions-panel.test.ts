import { describe, it, expect } from 'vitest';
import { selectActiveSessions, resolveActiveStatuses } from './active-sessions-panel.js';
import type { SessionStatus } from '../session-activity.js';
import type { ProjectRecord, Preferences } from '../../shared/types.js';

// Minimal project/session factory — only the fields the selector reads.
const project = (id: string, name: string, sessions: Array<{ id: string; name?: string; type?: string }>): ProjectRecord =>
  ({
    id,
    name,
    sessions: sessions.map((s) => ({ id: s.id, name: s.name ?? s.id, type: s.type })),
  } as unknown as ProjectRecord);

const statusMap = (m: Record<string, SessionStatus>) => (id: string): SessionStatus => m[id] ?? 'idle';

describe('selectActiveSessions', () => {
  it('keeps only sessions whose status is in the active set', () => {
    const projects = [project('p1', 'Alpha', [
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ])];
    const rows = selectActiveSessions(
      projects,
      statusMap({ a: 'working', b: 'idle', c: 'completed' }),
      new Set<SessionStatus>(['working', 'completed']),
    );
    expect(rows.map((r) => r.sessionId)).toEqual(['a', 'c']);
  });

  it('excludes non-CLI sessions (those with a type set)', () => {
    const projects = [project('p1', 'Alpha', [
      { id: 'cli' },
      { id: 'kanban', type: 'kanban' },
      { id: 'team', type: 'team' },
    ])];
    const rows = selectActiveSessions(
      projects,
      statusMap({ cli: 'working', kanban: 'working', team: 'working' }),
      new Set<SessionStatus>(['working']),
    );
    expect(rows.map((r) => r.sessionId)).toEqual(['cli']);
  });

  it('aggregates across all projects', () => {
    const projects = [
      project('p1', 'Alpha', [{ id: 'a' }]),
      project('p2', 'Beta', [{ id: 'b' }]),
    ];
    const rows = selectActiveSessions(
      projects,
      statusMap({ a: 'working', b: 'input' }),
      new Set<SessionStatus>(['working', 'input']),
    );
    expect(rows.map((r) => r.projectId).sort()).toEqual(['p1', 'p2']);
  });

  it('orders by status priority (input > working > waiting > completed), then project name', () => {
    const projects = [
      project('p1', 'Zeta', [{ id: 'w' }]),
      project('p2', 'Alpha', [{ id: 'i' }]),
      project('p3', 'Mid', [{ id: 'c' }]),
      project('p4', 'Beta', [{ id: 'w2' }]),
    ];
    const rows = selectActiveSessions(
      projects,
      statusMap({ w: 'working', i: 'input', c: 'completed', w2: 'working' }),
      new Set<SessionStatus>(['working', 'input', 'completed']),
    );
    // input first, then the two working (tie broken by project name Beta < Zeta), then completed.
    expect(rows.map((r) => r.sessionId)).toEqual(['i', 'w2', 'w', 'c']);
  });

  it('returns empty when the active set is empty', () => {
    const projects = [project('p1', 'Alpha', [{ id: 'a' }])];
    expect(selectActiveSessions(projects, statusMap({ a: 'working' }), new Set())).toEqual([]);
  });
});

describe('resolveActiveStatuses', () => {
  it('falls back to working/input/completed when unset', () => {
    const set = resolveActiveStatuses({} as Preferences);
    expect([...set].sort()).toEqual(['completed', 'input', 'working']);
  });

  it('reflects the configured flags', () => {
    const set = resolveActiveStatuses({
      activeSessionStatuses: { working: true, waiting: true, input: false, completed: false },
    } as Preferences);
    expect([...set].sort()).toEqual(['waiting', 'working']);
  });
});
