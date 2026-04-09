import type { ProjectRecord } from '../shared/types';

const { statusChangeCallbacks, mockAppState, appStateListeners } = vi.hoisted(() => {
  const listeners = new Map<string, Array<(data?: unknown) => void>>();
  return {
    statusChangeCallbacks: [] as Array<(sessionId: string, status: string) => void>,
    appStateListeners: listeners,
    mockAppState: {
      activeProjectId: null as string | null,
      projects: [] as ProjectRecord[],
      get activeProject(): ProjectRecord | null {
        return this.projects.find((p: ProjectRecord) => p.id === this.activeProjectId) ?? null;
      },
      on: vi.fn((event: string, cb: (data?: unknown) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(cb);
      }),
    },
  };
});

function fireAppStateEvent(event: string, data?: unknown): void {
  for (const cb of appStateListeners.get(event) ?? []) cb(data);
}

vi.mock('./session-activity', () => ({
  onChange: (cb: (sessionId: string, status: string) => void) => { statusChangeCallbacks.push(cb); },
  getStatus: vi.fn(),
}));

vi.mock('./state', () => ({ appState: mockAppState }));

import {
  init,
  isUnread,
  hasUnreadInProject,
  removeSession,
  onChange,
  _resetForTesting,
} from './session-unread';

beforeEach(() => {
  _resetForTesting();
  statusChangeCallbacks.length = 0;
  mockAppState.projects = [];
  mockAppState.activeProjectId = null;
  mockAppState.on.mockReset();
  appStateListeners.clear();
});

function setupProjects(): void {
  mockAppState.projects = [
    {
      id: 'p1',
      name: 'Project 1',
      directory: '/tmp/p1',
      sessions: [{ id: 's1', name: 'Session 1', providerId: 'claude' }],
      activeSessionId: 's1',
    },
    {
      id: 'p2',
      name: 'Project 2',
      directory: '/tmp/p2',
      sessions: [{ id: 's2', name: 'Session 2', providerId: 'claude' }],
      activeSessionId: 's2',
    },
  ];
}

function simulateStatusChange(sessionId: string, status: string): void {
  for (const cb of statusChangeCallbacks) cb(sessionId, status);
}

describe('session-unread', () => {
  it('marks session as unread when it transitions from working to waiting on a non-active project', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2'; // viewing project 2
    init();

    // Transition s1 (in project 1) from working → waiting
    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');

    expect(isUnread('s1')).toBe(true);
    expect(hasUnreadInProject('p1')).toBe(true);
  });

  it('does NOT mark session as unread when it is the active session of the active project', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p1'; // viewing project 1, which has s1 as active
    init();

    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');

    expect(isUnread('s1')).toBe(false);
  });

  it('marks non-active session as unread even when its project is active', () => {
    mockAppState.projects = [
      {
        id: 'p1',
        name: 'Project 1',
        directory: '/tmp/p1',
        sessions: [
          { id: 's1', name: 'Session 1', providerId: 'claude' },
          { id: 's2', name: 'Session 2', providerId: 'claude' },
        ],
        activeSessionId: 's1', // s1 is active, not s2
      },
    ];
    mockAppState.activeProjectId = 'p1';
    init();

    simulateStatusChange('s2', 'working');
    simulateStatusChange('s2', 'waiting');

    expect(isUnread('s2')).toBe(true);
  });

  it('marks active session as unread when its project is NOT the active project', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2'; // viewing p2, not p1
    init();

    // s1 is p1's activeSessionId, but p1 is not the active project
    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');

    expect(isUnread('s1')).toBe(true);
    expect(hasUnreadInProject('p1')).toBe(true);
  });

  it('does not mark unread for non working→waiting transitions', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();

    simulateStatusChange('s1', 'waiting');
    simulateStatusChange('s1', 'waiting');

    expect(isUnread('s1')).toBe(false);
  });

  it('removeSession clears unread state', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();

    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');
    expect(isUnread('s1')).toBe(true);

    removeSession('s1');
    expect(isUnread('s1')).toBe(false);
  });

  it('notifies listeners on unread change', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();

    const cb = vi.fn();
    onChange(cb);

    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');

    expect(cb).toHaveBeenCalled();
  });

  it('stops receiving callbacks after unsubscribe', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();

    const cb = vi.fn();
    const unsub = onChange(cb);

    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');
    expect(cb).toHaveBeenCalledTimes(1); // no new calls after unsub
  });

  it('only removes the specific subscriber', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = onChange(cb1);
    onChange(cb2);

    unsub1();
    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalled();
  });

  it('clears unread when the active session of the active project changes to an unread one', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();

    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');
    simulateStatusChange('s2', 'working');
    simulateStatusChange('s2', 'waiting');
    mockAppState.activeProjectId = 'p1';
    const listener = vi.fn();
    onChange(listener);
    fireAppStateEvent('session-changed');
    expect(isUnread('s1')).toBe(false);
    expect(listener).toHaveBeenCalled();
  });

  it('session-changed handler is a no-op when active session is not unread', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p1';
    init();
    const listener = vi.fn();
    onChange(listener);
    fireAppStateEvent('session-changed');
    expect(listener).not.toHaveBeenCalled();
  });

  it('session-removed handler removes the matching session from unread set', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();

    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');
    expect(isUnread('s1')).toBe(true);

    fireAppStateEvent('session-removed', { sessionId: 's1' });
    expect(isUnread('s1')).toBe(false);
  });

  it('session-removed handler ignores missing/malformed payloads', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();
    simulateStatusChange('s1', 'working');
    simulateStatusChange('s1', 'waiting');
    expect(isUnread('s1')).toBe(true);
    fireAppStateEvent('session-removed');
    fireAppStateEvent('session-removed', {});
    expect(isUnread('s1')).toBe(true);
  });

  it('removeSession for a session that was never unread does not notify listeners', () => {
    setupProjects();
    mockAppState.activeProjectId = 'p2';
    init();
    const cb = vi.fn();
    onChange(cb);
    removeSession('never-unread');
    expect(cb).not.toHaveBeenCalled();
  });
});
