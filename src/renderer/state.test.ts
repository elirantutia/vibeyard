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

vi.mock('./provider-availability.js', () => ({
  getProviderCapabilities: vi.fn(() => null),
  getProviderAvailabilitySnapshot: vi.fn(() => null),
  getTeamChatProviderMetas: vi.fn(() => []),
}));

import { appState, _resetForTesting, MAX_PROJECT_NAME_LENGTH } from './state';
import { getCost, restoreCost } from './session-cost.js';
import { restoreContext } from './session-context.js';

const mockGetCost = vi.mocked(getCost);
const mockRestoreCost = vi.mocked(restoreCost);
const mockRestoreContext = vi.mocked(restoreContext);

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  mockGetCost.mockReturnValue(null);
  _resetForTesting();
});

function addProject(name = 'Test', path = '/test') {
  return appState.addProject(name, path);
}

function addProjectWithSessions(count: number) {
  const project = addProject();
  const sessions = [];
  for (let i = 0; i < count; i++) {
    sessions.push(appState.addSession(project.id, `Session ${i + 1}`)!);
  }
  return { project, sessions };
}

describe('load()', () => {
  it('loads persisted state from store', async () => {
    const persisted = {
      version: 1,
      projects: [
        {
          id: 'p1',
          name: 'Proj',
          path: '/proj',
          sessions: [],
          activeSessionId: null,
          layout: { mode: 'tabs' as const, splitPanes: [], splitDirection: 'horizontal' as const },
        },
      ],
      activeProjectId: 'p1',
      preferences: { soundOnSessionWaiting: true, debugMode: false },
    };
    mockLoad.mockResolvedValue(persisted);
    await appState.load();
    expect(appState.projects).toHaveLength(1);
    expect(appState.activeProjectId).toBe('p1');
    expect(appState.preferences.soundOnSessionWaiting).toBe(true);
  });

  it('handles null return from store (keeps defaults)', async () => {
    mockLoad.mockResolvedValue(null);
    await appState.load();
    expect(appState.projects).toEqual([]);
    expect(appState.activeProjectId).toBeNull();
  });

  it('merges defaults for forward compatibility', async () => {
    const persisted = {
      version: 1,
      projects: [],
      activeProjectId: null,
      preferences: { soundOnSessionWaiting: true },
    };
    mockLoad.mockResolvedValue(persisted);
    await appState.load();
    // debugMode should be filled in from defaults
    expect(appState.preferences.debugMode).toBe(false);
    expect(appState.preferences.soundOnSessionWaiting).toBe(true);
  });

  it('emits state-loaded event', async () => {
    mockLoad.mockResolvedValue(null);
    const cb = vi.fn();
    appState.on('state-loaded', cb);
    await appState.load();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('restores persisted cost data into session-cost module', async () => {
    const costData = {
      totalCostUsd: 1.5,
      totalInputTokens: 500,
      totalOutputTokens: 200,
      cacheReadTokens: 100,
      cacheCreationTokens: 50,
      totalDurationMs: 1000,
      totalApiDurationMs: 800,
    };
    const persisted = {
      version: 1,
      projects: [{
        id: 'p1',
        name: 'Proj',
        path: '/proj',
        sessions: [
          { id: 's1', name: 'S1', cliSessionId: 'cli-1', createdAt: '2026-01-01', cost: costData },
          { id: 's2', name: 'S2', cliSessionId: null, createdAt: '2026-01-02' },
        ],
        activeSessionId: 's1',
        layout: { mode: 'tabs' as const, splitPanes: [], splitDirection: 'horizontal' as const },
      }],
      activeProjectId: 'p1',
      preferences: { soundOnSessionWaiting: false, debugMode: false },
    };
    mockLoad.mockResolvedValue(persisted);
    await appState.load();
    expect(mockRestoreCost).toHaveBeenCalledOnce();
    expect(mockRestoreCost).toHaveBeenCalledWith('s1', costData);
  });

  it('restores persisted context window data into session-context module', async () => {
    const contextData = { totalTokens: 5000, contextWindowSize: 200000, usedPercentage: 2.5 };
    const persisted = {
      version: 1,
      projects: [{
        id: 'p1',
        name: 'Proj',
        path: '/proj',
        sessions: [
          { id: 's1', name: 'S1', cliSessionId: null, createdAt: '2026-01-01', contextWindow: contextData },
        ],
        activeSessionId: 's1',
        layout: { mode: 'tabs' as const, splitPanes: [], splitDirection: 'horizontal' as const },
      }],
      activeProjectId: 'p1',
      preferences: { soundOnSessionWaiting: false, debugMode: false },
    };
    mockLoad.mockResolvedValue(persisted);
    await appState.load();
    expect(mockRestoreContext).toHaveBeenCalledOnce();
    expect(mockRestoreContext).toHaveBeenCalledWith('s1', contextData);
  });

  it('deduplicates history entry IDs on load', async () => {
    const persisted = {
      version: 1,
      projects: [{
        id: 'p1',
        name: 'Proj',
        path: '/proj',
        sessions: [],
        activeSessionId: null,
        layout: { mode: 'tabs' as const, splitPanes: [], splitDirection: 'horizontal' as const },
        sessionHistory: [
          { id: 'dup-id', name: 'Entry1', providerId: 'claude', cliSessionId: 'cli-a', createdAt: '2026-01-01', closedAt: '2026-01-01', cost: null },
          { id: 'dup-id', name: 'Entry2', providerId: 'claude', cliSessionId: 'cli-b', createdAt: '2026-01-02', closedAt: '2026-01-02', cost: null },
          { id: 'unique-id', name: 'Entry3', providerId: 'claude', cliSessionId: 'cli-c', createdAt: '2026-01-03', closedAt: '2026-01-03', cost: null },
        ],
      }],
      activeProjectId: 'p1',
      preferences: { soundOnSessionWaiting: false, debugMode: false },
    };
    mockLoad.mockResolvedValue(persisted);
    await appState.load();
    const history = appState.getSessionHistory('p1');
    expect(history).toHaveLength(3);
    // First entry keeps its ID, second gets a new one
    expect(history[0].id).toBe('dup-id');
    expect(history[1].id).not.toBe('dup-id');
    expect(history[2].id).toBe('unique-id');
    // All IDs are now unique
    const ids = new Set(history.map(h => h.id));
    expect(ids.size).toBe(3);
  });

  it('does not call restoreCost for sessions without cost', async () => {
    const persisted = {
      version: 1,
      projects: [{
        id: 'p1',
        name: 'Proj',
        path: '/proj',
        sessions: [{ id: 's1', name: 'S1', cliSessionId: null, createdAt: '2026-01-01' }],
        activeSessionId: 's1',
        layout: { mode: 'tabs' as const, splitPanes: [], splitDirection: 'horizontal' as const },
      }],
      activeProjectId: 'p1',
      preferences: { soundOnSessionWaiting: false, debugMode: false },
    };
    mockLoad.mockResolvedValue(persisted);
    await appState.load();
    expect(mockRestoreCost).not.toHaveBeenCalled();
  });
});

describe('persist()', () => {
  it('calls store.save after addProject', () => {
    addProject();
    expect(mockSave).toHaveBeenCalled();
    const savedState = mockSave.mock.calls[0][0];
    expect(savedState.projects).toHaveLength(1);
  });

  it('calls store.save after addSession', () => {
    const project = addProject();
    mockSave.mockClear();
    appState.addSession(project.id, 'S1');
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('getters', () => {
  it('projects returns empty array by default', () => {
    expect(appState.projects).toEqual([]);
  });

  it('activeProjectId returns null by default', () => {
    expect(appState.activeProjectId).toBeNull();
  });

  it('activeProject returns undefined when no projects', () => {
    expect(appState.activeProject).toBeUndefined();
  });

  it('activeSession returns undefined when no project', () => {
    expect(appState.activeSession).toBeUndefined();
  });

  it('activeProject returns the active project', () => {
    const project = addProject('My Proj', '/my');
    expect(appState.activeProject).toBeDefined();
    expect(appState.activeProject!.id).toBe(project.id);
  });

  it('activeSession returns the active session', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    expect(appState.activeSession).toBeDefined();
    expect(appState.activeSession!.id).toBe(session.id);
  });

  it('sidebarWidth returns undefined by default', () => {
    expect(appState.sidebarWidth).toBeUndefined();
  });
});

describe('addProject()', () => {
  it('creates project with UUID and sets it active', () => {
    const project = addProject('Foo', '/foo');
    expect(project.id).toBe('uuid-1');
    expect(project.name).toBe('Foo');
    expect(project.path).toBe('/foo');
    expect(project.sessions).toEqual([]);
    expect(project.activeSessionId).toBeNull();
    expect(appState.activeProjectId).toBe('uuid-1');
  });

  it('emits project-added and project-changed', () => {
    const addedCb = vi.fn();
    const changedCb = vi.fn();
    appState.on('project-added', addedCb);
    appState.on('project-changed', changedCb);
    const project = addProject();
    expect(addedCb).toHaveBeenCalledWith(project);
    expect(changedCb).toHaveBeenCalledTimes(1);
  });

  it('initializes a default board so the kanban tab renders without an app restart', () => {
    const project = addProject();
    expect(project.board).toBeDefined();
    expect(project.board!.columns.map(c => c.title)).toEqual(['Backlog', 'Ready', 'Running', 'Done']);
    expect(project.board!.tasks).toEqual([]);
  });
});

describe('openKanbanTab()', () => {
  it('backfills a missing board on the project before opening the tab', () => {
    const project = addProject();
    delete project.board;
    const session = appState.openKanbanTab(project.id);
    expect(session?.type).toBe('kanban');
    expect(project.board).toBeDefined();
    expect(project.board!.columns).toHaveLength(4);
  });
});

describe('removeProject()', () => {
  it('removes the project and falls back to first remaining', () => {
    const p1 = addProject('P1', '/p1');
    const p2 = addProject('P2', '/p2');
    // p2 is active now
    appState.removeProject(p2.id);
    expect(appState.projects).toHaveLength(1);
    expect(appState.activeProjectId).toBe(p1.id);
  });

  it('sets activeProjectId to null when last project removed', () => {
    const p = addProject();
    appState.removeProject(p.id);
    expect(appState.projects).toHaveLength(0);
    expect(appState.activeProjectId).toBeNull();
  });

  it('emits project-removed and project-changed', () => {
    const removedCb = vi.fn();
    const changedCb = vi.fn();
    const p = addProject();
    appState.on('project-removed', removedCb);
    appState.on('project-changed', changedCb);
    appState.removeProject(p.id);
    expect(removedCb).toHaveBeenCalledWith(p.id);
    expect(changedCb).toHaveBeenCalled();
  });

  it('emits session-removed for each session before removing project', () => {
    const sessionRemovedCb = vi.fn();
    const p = addProject();
    const s1 = appState.addSession(p.id, 'S1')!;
    const s2 = appState.addSession(p.id, 'S2')!;
    appState.on('session-removed', sessionRemovedCb);
    appState.removeProject(p.id);
    expect(sessionRemovedCb).toHaveBeenCalledTimes(2);
    expect(sessionRemovedCb).toHaveBeenCalledWith({ projectId: p.id, sessionId: s1.id });
    expect(sessionRemovedCb).toHaveBeenCalledWith({ projectId: p.id, sessionId: s2.id });
  });
});

describe('renameProject()', () => {
  it('renames an existing project', () => {
    const p = addProject('Old', '/path');
    appState.renameProject(p.id, 'New');
    expect(appState.projects[0].name).toBe('New');
    expect(appState.projects[0].path).toBe('/path');
  });

  it('trims whitespace', () => {
    const p = addProject('Old');
    appState.renameProject(p.id, '  Spaced  ');
    expect(appState.projects[0].name).toBe('Spaced');
  });

  it('is a no-op when name is empty or whitespace', () => {
    const p = addProject('Old');
    appState.renameProject(p.id, '   ');
    expect(appState.projects[0].name).toBe('Old');
  });

  it('is a no-op when name is unchanged', () => {
    const p = addProject('Same');
    const changedCb = vi.fn();
    appState.on('project-changed', changedCb);
    appState.renameProject(p.id, 'Same');
    expect(changedCb).not.toHaveBeenCalled();
  });

  it('is a no-op for unknown project id', () => {
    addProject('Real');
    appState.renameProject('does-not-exist', 'Anything');
    expect(appState.projects[0].name).toBe('Real');
  });

  it('truncates name exceeding MAX_PROJECT_NAME_LENGTH', () => {
    const p = addProject('Old');
    const longName = 'A'.repeat(MAX_PROJECT_NAME_LENGTH + 30);
    appState.renameProject(p.id, longName);
    expect(appState.projects[0].name).toBe('A'.repeat(MAX_PROJECT_NAME_LENGTH));
  });

  it('emits project-changed and persists', () => {
    const p = addProject('Old');
    const changedCb = vi.fn();
    appState.on('project-changed', changedCb);
    mockSave.mockClear();
    appState.renameProject(p.id, 'New');
    expect(changedCb).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('addSession()', () => {
  it('creates a session and sets it active', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1', '--verbose')!;
    expect(session).toBeDefined();
    expect(session.name).toBe('S1');
    expect(session.args).toBe('--verbose');
    expect(session.cliSessionId).toBeNull();
    expect(appState.activeProject!.activeSessionId).toBe(session.id);
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addSession('nonexistent', 'S')).toBeUndefined();
  });

  it('emits session-added and session-changed', () => {
    const addedCb = vi.fn();
    const changedCb = vi.fn();
    const project = addProject();
    appState.on('session-added', addedCb);
    appState.on('session-changed', changedCb);
    appState.addSession(project.id, 'S1');
    expect(addedCb).toHaveBeenCalledTimes(1);
    expect(changedCb).toHaveBeenCalledTimes(1);
  });

  it('uses project defaultArgs when no explicit args provided', () => {
    const project = addProject();
    project.defaultArgs = '--model sonnet';
    const session = appState.addSession(project.id, 'S1')!;
    expect(session.args).toBe('--model sonnet');
  });

  it('explicit args override project defaultArgs', () => {
    const project = addProject();
    project.defaultArgs = '--model sonnet';
    const session = appState.addSession(project.id, 'S1', '--model opus')!;
    expect(session.args).toBe('--model opus');
  });

  it('no args when neither explicit args nor defaultArgs set', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    expect(session.args).toBeUndefined();
  });

  it('pins an explicitly-passed profile that matches the provider', () => {
    const project = addProject();
    appState.profiles.push({ id: 'prof-1', name: 'Work', providerId: 'claude', configDir: '/x', managed: true, createdAt: 0 });
    const session = appState.addSession(project.id, 'S1', undefined, 'claude', 'prof-1')!;
    expect(session.profileId).toBe('prof-1');
  });

  it('does not pin a profile whose provider mismatches', () => {
    const project = addProject();
    appState.profiles.push({ id: 'prof-2', name: 'Other', providerId: 'codex', configDir: '/y', managed: true, createdAt: 0 });
    const session = appState.addSession(project.id, 'S1', undefined, 'claude', 'prof-2')!;
    expect(session.profileId).toBeUndefined();
  });
});

describe('addPlanSession()', () => {
  it('forwards profileId to addSession', () => {
    const project = addProject();
    const spy = vi.spyOn(appState, 'addSession');
    appState.addPlanSession(project.id, 'S1', true, 'claude', 'prof-1');
    expect(spy.mock.calls[0][4]).toBe('prof-1');
  });
});

describe('removeSession()', () => {
  it('closing last tab activates previous tab', () => {
    const { project, sessions } = addProjectWithSessions(3);
    // active is the last added session (sessions[2])
    appState.removeSession(project.id, sessions[2].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[1].id);
  });

  it('closing middle tab activates previous tab', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[1].id);
    appState.removeSession(project.id, sessions[1].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[0].id);
  });

  it('closing first tab activates next tab', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[0].id);
    appState.removeSession(project.id, sessions[0].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[1].id);
  });

  it('sets activeSessionId to null when last session removed', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    expect(appState.activeProject!.activeSessionId).toBeNull();
  });

  it('clears session from splitPanes', () => {
    const { project, sessions } = addProjectWithSessions(2);
    appState.toggleSwarm();
    expect(appState.activeProject!.layout.splitPanes.length).toBeGreaterThan(0);
    appState.removeSession(project.id, sessions[0].id);
    expect(appState.activeProject!.layout.splitPanes).not.toContain(sessions[0].id);
  });

  it('emits session-removed and session-changed', () => {
    const removedCb = vi.fn();
    const changedCb = vi.fn();
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.on('session-removed', removedCb);
    appState.on('session-changed', changedCb);
    appState.removeSession(project.id, session.id);
    expect(removedCb).toHaveBeenCalledWith({ projectId: project.id, sessionId: session.id });
    expect(changedCb).toHaveBeenCalled();
  });
});

describe('reorderProject()', () => {
  it('moves project forward', () => {
    const a = appState.addProject('A', '/a');
    const b = appState.addProject('B', '/b');
    const c = appState.addProject('C', '/c');
    appState.reorderProject(0, 2);
    expect(appState.projects.map((p) => p.id)).toEqual([b.id, c.id, a.id]);
  });

  it('moves project backward', () => {
    const a = appState.addProject('A', '/a');
    const b = appState.addProject('B', '/b');
    const c = appState.addProject('C', '/c');
    appState.reorderProject(2, 0);
    expect(appState.projects.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
  });

  it('no-op when fromIndex === toIndex', () => {
    const a = appState.addProject('A', '/a');
    const b = appState.addProject('B', '/b');
    const cb = vi.fn();
    appState.on('project-changed', cb);
    mockSave.mockClear();
    appState.reorderProject(1, 1);
    expect(mockSave).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    expect(appState.projects.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it('no-op when index is out of range', () => {
    const a = appState.addProject('A', '/a');
    const b = appState.addProject('B', '/b');
    const cb = vi.fn();
    appState.on('project-changed', cb);
    mockSave.mockClear();
    appState.reorderProject(0, 5);
    appState.reorderProject(-1, 0);
    appState.reorderProject(5, 0);
    expect(mockSave).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
    expect(appState.projects.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it('emits project-changed and persists', () => {
    appState.addProject('A', '/a');
    appState.addProject('B', '/b');
    const cb = vi.fn();
    appState.on('project-changed', cb);
    mockSave.mockClear();
    appState.reorderProject(0, 1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('preferences', () => {
  it('setPreference updates and persists', () => {
    appState.setPreference('debugMode', true);
    expect(appState.preferences.debugMode).toBe(true);
    expect(mockSave).toHaveBeenCalled();
  });

  it('setPreference emits preferences-changed', () => {
    const cb = vi.fn();
    appState.on('preferences-changed', cb);
    appState.setPreference('soundOnSessionWaiting', true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('zoomFactor defaults to 1.0', () => {
    expect(appState.preferences.zoomFactor).toBe(1.0);
  });

  it('setPreference stores zoomFactor', () => {
    appState.setPreference('zoomFactor', 1.5);
    expect(appState.preferences.zoomFactor).toBe(1.5);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('setSidebarWidth()', () => {
  it('sets sidebarWidth and persists', () => {
    appState.setSidebarWidth(300);
    expect(appState.sidebarWidth).toBe(300);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('toggleSidebar()', () => {
  it('toggles sidebarCollapsed, persists, and emits', () => {
    expect(appState.sidebarCollapsed).toBe(false);
    const cb = vi.fn();
    appState.on('sidebar-toggled', cb);
    appState.toggleSidebar();
    expect(appState.sidebarCollapsed).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalled();
  });

  it('toggles back to false', () => {
    appState.toggleSidebar(); // true
    appState.toggleSidebar(); // false
    expect(appState.sidebarCollapsed).toBe(false);
  });
});

describe('setTerminalPanelOpen()', () => {
  it('sets terminalPanelOpen on active project and emits', () => {
    addProject();
    const cb = vi.fn();
    appState.on('terminal-panel-changed', cb);
    appState.setTerminalPanelOpen(true);
    expect(appState.activeProject!.terminalPanelOpen).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalled();
  });

  it('no-op when no active project', () => {
    mockSave.mockClear();
    appState.setTerminalPanelOpen(true);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('setTerminalPanelHeight()', () => {
  it('sets terminalPanelHeight on active project', () => {
    addProject();
    appState.setTerminalPanelHeight(250);
    expect(appState.activeProject!.terminalPanelHeight).toBe(250);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('on() / event system', () => {
  it('returns an unsubscribe function that works', () => {
    const cb = vi.fn();
    const unsub = appState.on('project-changed', cb);
    addProject();
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    addProject();
    expect(cb).toHaveBeenCalledTimes(1); // not called again
  });
});

describe('setActiveProject()', () => {
  it('sets activeProjectId and emits project-changed', () => {
    const p1 = addProject('P1', '/p1');
    addProject('P2', '/p2');
    const cb = vi.fn();
    appState.on('project-changed', cb);
    appState.setActiveProject(p1.id);
    expect(appState.activeProjectId).toBe(p1.id);
    expect(cb).toHaveBeenCalled();
    expect(mockSave).toHaveBeenCalled();
  });
});

// --- Session History Tests ---

function mockCostData() {
  mockGetCost.mockReturnValue({
    totalCostUsd: 0.42,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalDurationMs: 5000,
    totalApiDurationMs: 3000,
  });
}

