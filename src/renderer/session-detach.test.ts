import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: mockLoad, save: mockSave },
  },
});

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

vi.mock('./session-cost.js', () => ({
  getCost: vi.fn().mockReturnValue(null),
  restoreCost: vi.fn(),
}));

vi.mock('./session-context.js', () => ({
  restoreContext: vi.fn(),
}));

const { mockShowConfirmDialog, mockGetStatus } = vi.hoisted(() => ({
  mockShowConfirmDialog: vi.fn(),
  mockGetStatus: vi.fn(),
}));

vi.mock('./components/modal.js', () => ({
  showConfirmDialog: mockShowConfirmDialog,
}));

vi.mock('./session-activity.js', () => ({
  getStatus: mockGetStatus,
}));

import { appState, _resetForTesting } from './state';
import { closeTab, closeTabsByMode, closeSessionWithConfirm } from './session-close';
import { tabSessions } from './session-utils';
import { ensureProjectDefaults } from './state/persistence';
import type { PersistedState, ProjectRecord, SessionRecord } from '../shared/types';

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  mockGetStatus.mockReturnValue('idle');
  _resetForTesting();
});

function seed(count: number) {
  const project = appState.addProject('P', '/p');
  const sessions: SessionRecord[] = [];
  for (let i = 0; i < count; i++) sessions.push(appState.addSession(project.id, `S${i + 1}`)!);
  return { project, sessions };
}

const ids = (list: { id: string }[]) => list.map((s) => s.id);
const current = (projectId: string): ProjectRecord => appState.projects.find((p) => p.id === projectId)!;

describe('closeTab on a CLI session', () => {
  it('keeps the session (detached) instead of removing it', () => {
    const { project, sessions } = seed(2);
    const removed = vi.fn();
    appState.on('session-removed', removed);

    closeTab(project.id, sessions[1].id);

    const p = current(project.id);
    expect(ids(p.sessions)).toEqual([sessions[0].id, sessions[1].id]);
    expect(p.sessions[1].detached).toBe(true);
    expect(ids(tabSessions(p))).toEqual([sessions[0].id]);
    expect(removed).not.toHaveBeenCalled();
  });

  it('never asks for confirmation, even while the session is working', () => {
    const { project, sessions } = seed(1);
    mockGetStatus.mockReturnValue('working');

    closeTab(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(current(project.id).sessions[0].detached).toBe(true);
  });

  it('activates the left tab neighbour when the active tab is detached', () => {
    const { project, sessions } = seed(3);
    appState.setActiveSession(project.id, sessions[1].id);

    closeTab(project.id, sessions[1].id);

    expect(current(project.id).activeSessionId).toBe(sessions[0].id);
  });

  it('leaves no active tab when the last tab is detached', () => {
    const { project, sessions } = seed(1);
    closeTab(project.id, sessions[0].id);
    expect(current(project.id).activeSessionId).toBeNull();
  });

  it('drops the session from the swarm panes', () => {
    const { project, sessions } = seed(2);
    appState.toggleSwarm();
    expect(current(project.id).layout.splitPanes).toContain(sessions[0].id);

    closeTab(project.id, sessions[0].id);

    expect(current(project.id).layout.splitPanes).toEqual([sessions[1].id]);
  });

  it('moves the detached session after every tab', () => {
    const { project, sessions } = seed(3);
    closeTab(project.id, sessions[0].id);
    expect(ids(current(project.id).sessions)).toEqual([sessions[1].id, sessions[2].id, sessions[0].id]);
  });
});

describe('closeTab on a non-CLI tab', () => {
  it('removes it outright', () => {
    const { project } = seed(1);
    const browser = appState.addBrowserTabSession(project.id, 'https://example.com')!;

    closeTab(project.id, browser.id);

    expect(ids(current(project.id).sessions)).not.toContain(browser.id);
  });
});

describe('reopening a detached session', () => {
  it('setActiveSession gives it a tab back, after the last tab', () => {
    const { project, sessions } = seed(3);
    closeTab(project.id, sessions[0].id);

    appState.setActiveSession(project.id, sessions[0].id);

    const p = current(project.id);
    expect(p.sessions.find((s) => s.id === sessions[0].id)!.detached).toBeUndefined();
    expect(ids(tabSessions(p))).toEqual([sessions[1].id, sessions[2].id, sessions[0].id]);
    expect(p.activeSessionId).toBe(sessions[0].id);
  });

  it('keeps the remaining detached sessions after the tabs', () => {
    const { project, sessions } = seed(3);
    closeTab(project.id, sessions[0].id);
    closeTab(project.id, sessions[1].id);

    appState.setActiveSession(project.id, sessions[1].id);

    expect(ids(current(project.id).sessions)).toEqual([sessions[2].id, sessions[1].id, sessions[0].id]);
  });

  it('rejoins the swarm panes in swarm mode', () => {
    const { project, sessions } = seed(2);
    appState.toggleSwarm();
    closeTab(project.id, sessions[0].id);

    appState.setActiveSession(project.id, sessions[0].id);

    expect(current(project.id).layout.splitPanes).toEqual([sessions[1].id, sessions[0].id]);
  });
});

describe('tab navigation ignores detached sessions', () => {
  it('a new session is inserted before the detached ones', () => {
    const { project, sessions } = seed(2);
    closeTab(project.id, sessions[0].id);

    const added = appState.addSession(project.id, 'S3')!;

    expect(ids(current(project.id).sessions)).toEqual([sessions[1].id, added.id, sessions[0].id]);
  });

  it('cycleSession skips detached sessions', () => {
    const { project, sessions } = seed(3);
    closeTab(project.id, sessions[1].id);
    appState.setActiveSession(project.id, sessions[2].id);

    appState.cycleSession(1);
    expect(current(project.id).activeSessionId).toBe(sessions[0].id);
    appState.cycleSession(1);
    expect(current(project.id).activeSessionId).toBe(sessions[2].id);
  });

  it('gotoSession indexes tabs only', () => {
    const { project, sessions } = seed(2);
    closeTab(project.id, sessions[1].id);

    appState.gotoSession(1);

    expect(current(project.id).activeSessionId).toBe(sessions[0].id);
  });

  it('reorderSession never moves a tab among the detached sessions', () => {
    const { project, sessions } = seed(3);
    closeTab(project.id, sessions[2].id);

    appState.reorderSession(project.id, sessions[0].id, 2);

    expect(ids(current(project.id).sessions)).toEqual([sessions[1].id, sessions[0].id, sessions[2].id]);
  });
});

describe('batch tab closes', () => {
  it('closeAllTabs detaches CLI sessions and removes other tabs, without confirmation', () => {
    const { project, sessions } = seed(2);
    mockGetStatus.mockReturnValue('working');
    const browser = appState.addBrowserTabSession(project.id)!;

    closeTabsByMode(project.id, 'all');

    const p = current(project.id);
    expect(ids(p.sessions)).toEqual(ids(sessions));
    expect(p.sessions.every((s) => s.detached)).toBe(true);
    expect(ids(p.sessions)).not.toContain(browser.id);
    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
  });

  it('closeOtherTabs keeps the anchor tab', () => {
    const { project, sessions } = seed(3);
    closeTabsByMode(project.id, 'others', sessions[1].id);
    expect(ids(tabSessions(current(project.id)))).toEqual([sessions[1].id]);
  });

  it('closeTabsToRight / closeTabsToLeft count tabs only', () => {
    const { project, sessions } = seed(4);
    closeTab(project.id, sessions[0].id); // tabs: S2 S3 S4

    closeTabsByMode(project.id, 'right', sessions[2].id);
    expect(ids(tabSessions(current(project.id)))).toEqual([sessions[1].id, sessions[2].id]);

    closeTabsByMode(project.id, 'left', sessions[2].id);
    expect(ids(tabSessions(current(project.id)))).toEqual([sessions[2].id]);
  });
});

describe('full close of a detached session', () => {
  it('closeSessionWithConfirm removes it for good', () => {
    const { project, sessions } = seed(2);
    closeTab(project.id, sessions[1].id);
    const removed = vi.fn();
    appState.on('session-removed', removed);

    closeSessionWithConfirm(project.id, sessions[1].id);

    expect(ids(current(project.id).sessions)).toEqual([sessions[0].id]);
    expect(removed).toHaveBeenCalledWith({ projectId: project.id, sessionId: sessions[1].id });
  });

  it('keeps the active tab when the removed session was detached', () => {
    const { project, sessions } = seed(2);
    closeTab(project.id, sessions[0].id);
    expect(current(project.id).activeSessionId).toBe(sessions[1].id);

    closeSessionWithConfirm(project.id, sessions[0].id);

    expect(current(project.id).activeSessionId).toBe(sessions[1].id);
  });
});

describe('project menu "Close All Sessions"', () => {
  it('removeAllSessions ends detached sessions too', () => {
    const { project, sessions } = seed(2);
    closeTab(project.id, sessions[0].id);

    appState.removeAllSessions(project.id);

    expect(current(project.id).sessions).toEqual([]);
  });
});

describe('batch tab close emits once', () => {
  it('closeTabsByMode re-renders once for the whole batch', () => {
    const { project } = seed(3);
    const changed = vi.fn();
    appState.on('session-changed', changed);

    closeTabsByMode(project.id, 'all');

    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('never activates a tab removed in the same batch', () => {
    const { project, sessions } = seed(1);
    const browser = appState.addBrowserTabSession(project.id)!;
    appState.setActiveSession(project.id, browser.id);

    closeTabsByMode(project.id, 'all');

    expect(current(project.id).activeSessionId).toBeNull();
    expect(current(project.id).sessions.map((s) => s.id)).toEqual([sessions[0].id]);
  });
});

describe('ensureProjectDefaults with detached sessions', () => {
  const session = (id: string, detached?: boolean): SessionRecord =>
    ({ id, name: id, cliSessionId: null, createdAt: '', ...(detached ? { detached } : {}) });

  it('moves detached sessions after the tabs and out of the active tab / panes', () => {
    const state = {
      version: 1,
      activeProjectId: 'p',
      preferences: {},
      projects: [{
        id: 'p',
        name: 'P',
        path: '/p',
        sessions: [session('a', true), session('b'), session('c')],
        activeSessionId: 'a',
        layout: { mode: 'swarm', splitPanes: ['a', 'b', 'c'], splitDirection: 'horizontal' },
      }],
    } as unknown as PersistedState;

    ensureProjectDefaults(state);

    const p = state.projects[0];
    expect(ids(p.sessions)).toEqual(['b', 'c', 'a']);
    expect(p.activeSessionId).toBe('b');
    expect(p.layout.splitPanes).toEqual(['b', 'c']);
  });
});
