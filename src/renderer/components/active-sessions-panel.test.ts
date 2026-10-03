import { describe, it, expect } from 'vitest';
import { selectActiveSessions } from './active-sessions-panel.js';
import type { SessionStatus } from '../session-activity.js';
import type { ProjectRecord, ProviderId } from '../../shared/types.js';

// Minimal project/session factory — only the fields the selector reads.
const project = (
  id: string,
  name: string,
  sessions: Array<{ id: string; name?: string; type?: string; providerId?: ProviderId }>,
): ProjectRecord =>
  ({
    id,
    name,
    sessions: sessions.map((s) => ({
      id: s.id,
      name: s.name ?? s.id,
      type: s.type,
      providerId: s.providerId,
      cliSessionId: null,
      createdAt: new Date().toISOString(),
    })),
  } as unknown as ProjectRecord);

const statusMap = (m: Record<string, SessionStatus>) => (id: string): SessionStatus => m[id] ?? 'idle';

describe('selectActiveSessions', () => {
  it('lists every open CLI session across all projects, regardless of status', () => {
    const projects = [
      project('p1', 'Alpha', [
        { id: 's1' },
        { id: 's2' },
        { id: 's3' },
        { id: 's4' },
      ]),
      project('p2', 'Beta', [{ id: 's5' }]),
    ];
    const statusOf = statusMap({ s1: 'working', s2: 'waiting', s3: 'completed', s4: 'input', s5: 'idle' });

    const rows = selectActiveSessions(projects, statusOf);

    // Every open session is listed — waiting and idle included.
    expect(rows.map((r) => r.sessionId).sort()).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(rows.find((r) => r.sessionId === 's2')!.status).toBe('waiting');
    expect(rows.find((r) => r.sessionId === 's5')!.status).toBe('idle');
  });

  it('excludes non-CLI sessions (those with a type set)', () => {
    const projects = [
      project('p1', 'Alpha', [
        { id: 'cli' },
        { id: 'shell', type: 'shell' },
      ]),
    ];

    const rows = selectActiveSessions(projects, statusMap({}));

    expect(rows.map((r) => r.sessionId)).toEqual(['cli']);
  });

  it('aggregates across all projects with project names', () => {
    const projects = [
      project('p1', 'Alpha', [{ id: 's1' }]),
      project('p2', 'Beta', [{ id: 's2' }]),
    ];

    const rows = selectActiveSessions(projects, statusMap({}));

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.projectId, r.projectName, r.sessionId].join('/')).sort()).toEqual([
      'p1/Alpha/s1',
      'p2/Beta/s2',
    ]);
  });

  it('orders by status priority (input > working > waiting > completed > idle), then project name, then session name', () => {
    const projects = [
      project('p1', 'Alpha', [
        { id: 'idle-a', name: 'zeta' },
        { id: 'input-a', name: 'alpha' },
        { id: 'working-a', name: 'mid' },
      ]),
      project('p2', 'Beta', [
        { id: 'input-b', name: 'beta' },
        { id: 'completed-b', name: 'omega' },
      ]),
    ];
    const statusOf = statusMap({
      'idle-a': 'idle',
      'input-a': 'input',
      'working-a': 'working',
      'input-b': 'input',
      'completed-b': 'completed',
    });

    const rows = selectActiveSessions(projects, statusOf);

    expect(rows.map((r) => r.sessionId)).toEqual(['input-a', 'input-b', 'working-a', 'completed-b', 'idle-a']);
  });

  it('returns empty for no projects or no sessions', () => {
    expect(selectActiveSessions([], statusMap({}))).toEqual([]);
    expect(selectActiveSessions([project('p1', 'Alpha', [])], statusMap({}))).toEqual([]);
  });
});
