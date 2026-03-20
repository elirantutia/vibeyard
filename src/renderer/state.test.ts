import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();

vi.stubGlobal('window', {
  claudeIde: {
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

import { appState, _resetForTesting } from './state';
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

// Helper: add a project and return it
function addProject(name = 'Test', path = '/test') {
  return appState.addProject(name, path);
}

// Helper: add a project with sessions
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
});

describe('addDiffViewerSession()', () => {
  it('creates a diff-viewer session', () => {
    const project = addProject();
    const session = appState.addDiffViewerSession(project.id, '/path/to/file.ts', 'staged')!;
    expect(session.type).toBe('diff-viewer');
    expect(session.diffFilePath).toBe('/path/to/file.ts');
    expect(session.diffArea).toBe('staged');
    expect(session.name).toBe('file.ts');
  });

  it('deduplicates existing same file+area+worktree', () => {
    const project = addProject();
    const s1 = appState.addDiffViewerSession(project.id, '/f.ts', 'staged', '/wt')!;
    const s2 = appState.addDiffViewerSession(project.id, '/f.ts', 'staged', '/wt')!;
    expect(s2.id).toBe(s1.id);
    expect(appState.activeProject!.sessions).toHaveLength(1);
  });

  it('does not deduplicate different area', () => {
    const project = addProject();
    appState.addDiffViewerSession(project.id, '/f.ts', 'staged');
    appState.addDiffViewerSession(project.id, '/f.ts', 'unstaged');
    expect(appState.activeProject!.sessions).toHaveLength(2);
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addDiffViewerSession('nope', '/f', 'staged')).toBeUndefined();
  });
});

describe('addFileReaderSession()', () => {
  it('creates a file-reader session', () => {
    const project = addProject();
    const session = appState.addFileReaderSession(project.id, '/path/to/readme.md')!;
    expect(session.type).toBe('file-reader');
    expect(session.fileReaderPath).toBe('/path/to/readme.md');
    expect(session.name).toBe('readme.md');
  });

  it('deduplicates existing same path', () => {
    const project = addProject();
    const s1 = appState.addFileReaderSession(project.id, '/f.ts')!;
    const s2 = appState.addFileReaderSession(project.id, '/f.ts')!;
    expect(s2.id).toBe(s1.id);
    expect(appState.activeProject!.sessions).toHaveLength(1);
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addFileReaderSession('nope', '/f')).toBeUndefined();
  });
});

describe('addMcpInspectorSession()', () => {
  it('creates an mcp-inspector session', () => {
    const project = addProject();
    const session = appState.addMcpInspectorSession(project.id, 'Inspector')!;
    expect(session.type).toBe('mcp-inspector');
    expect(session.name).toBe('Inspector');
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addMcpInspectorSession('nope', 'I')).toBeUndefined();
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
    appState.toggleSplit(); // populate splitPanes
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

describe('setActiveSession()', () => {
  it('updates activeSessionId and persists', () => {
    const { project, sessions } = addProjectWithSessions(2);
    mockSave.mockClear();
    appState.setActiveSession(project.id, sessions[0].id);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[0].id);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('updateSessionCliId()', () => {
  it('updates cliSessionId and persists', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    mockSave.mockClear();
    appState.updateSessionCliId(project.id, session.id, 'claude-abc');
    expect(appState.activeSession!.cliSessionId).toBe('claude-abc');
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('updateSessionCost()', () => {
  const sampleCost = {
    totalCostUsd: 2.5,
    totalInputTokens: 1000,
    totalOutputTokens: 400,
    cacheReadTokens: 50,
    cacheCreationTokens: 25,
    totalDurationMs: 3000,
    totalApiDurationMs: 2000,
  };

  it('persists cost data on the session record', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    mockSave.mockClear();
    appState.updateSessionCost(session.id, sampleCost);
    const updated = appState.activeProject!.sessions.find(s => s.id === session.id)!;
    expect(updated.cost).toEqual(sampleCost);
    expect(mockSave).toHaveBeenCalled();
  });

  it('no-op for nonexistent session', () => {
    addProject();
    mockSave.mockClear();
    appState.updateSessionCost('nonexistent', sampleCost);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('updates cost across projects', () => {
    const p1 = addProject('P1', '/p1');
    const p2 = addProject('P2', '/p2');
    const s1 = appState.addSession(p1.id, 'S1')!;
    appState.addSession(p2.id, 'S2');
    appState.updateSessionCost(s1.id, sampleCost);
    const found = appState.projects.find(p => p.id === p1.id)!.sessions.find(s => s.id === s1.id)!;
    expect(found.cost).toEqual(sampleCost);
  });
});

describe('updateSessionContext()', () => {
  const sampleContext = { totalTokens: 5000, contextWindowSize: 200000, usedPercentage: 2.5 };

  it('persists context data on the session record', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    mockSave.mockClear();
    appState.updateSessionContext(session.id, sampleContext);
    const updated = appState.activeProject!.sessions.find(s => s.id === session.id)!;
    expect(updated.contextWindow).toEqual(sampleContext);
    expect(mockSave).toHaveBeenCalled();
  });

  it('no-op for nonexistent session', () => {
    addProject();
    mockSave.mockClear();
    appState.updateSessionContext('nonexistent', sampleContext);
    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe('renameSession()', () => {
  it('updates session name and persists', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Old')!;
    mockSave.mockClear();
    appState.renameSession(project.id, session.id, 'New');
    expect(appState.activeSession!.name).toBe('New');
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('toggleSplit()', () => {
  it('switches from tabs to split and populates splitPanes', () => {
    const { project, sessions } = addProjectWithSessions(3);
    // active session is sessions[2] (the last added)
    appState.toggleSplit();
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('split');
    expect(layout.splitPanes).toContain(sessions[2].id);
    expect(layout.splitPanes.length).toBe(2);
  });

  it('switches from split back to tabs and clears splitPanes', () => {
    addProjectWithSessions(2);
    appState.toggleSplit(); // tabs -> split
    appState.toggleSplit(); // split -> tabs
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('tabs');
    expect(layout.splitPanes).toEqual([]);
  });

  it('emits layout-changed', () => {
    addProjectWithSessions(2);
    const cb = vi.fn();
    appState.on('layout-changed', cb);
    appState.toggleSplit();
    expect(cb).toHaveBeenCalledTimes(1);
  });
});

describe('cycleSession()', () => {
  it('cycles forward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[0].id);
    appState.cycleSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[1].id);
  });

  it('cycles backward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[0].id);
    appState.cycleSession(-1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[2].id);
  });

  it('wraps around forward', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.setActiveSession(project.id, sessions[2].id);
    appState.cycleSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[0].id);
  });
});

describe('gotoSession()', () => {
  it('goes to session by index', () => {
    const { sessions } = addProjectWithSessions(3);
    appState.gotoSession(1);
    expect(appState.activeProject!.activeSessionId).toBe(sessions[1].id);
  });

  it('no-op for out-of-bounds index', () => {
    const { sessions } = addProjectWithSessions(2);
    const before = appState.activeProject!.activeSessionId;
    appState.gotoSession(5);
    expect(appState.activeProject!.activeSessionId).toBe(before);
  });
});

describe('batch removals', () => {
  it('removeAllSessions removes all sessions', () => {
    const { project } = addProjectWithSessions(3);
    appState.removeAllSessions(project.id);
    expect(appState.activeProject!.sessions).toHaveLength(0);
  });

  it('removeSessionsFromRight removes sessions after given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeSessionsFromRight(project.id, sessions[1].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.sessions.map((s) => s.id)).toEqual([sessions[0].id, sessions[1].id]);
  });

  it('removeSessionsFromLeft removes sessions before given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeSessionsFromLeft(project.id, sessions[2].id);
    expect(appState.activeProject!.sessions).toHaveLength(2);
    expect(appState.activeProject!.sessions.map((s) => s.id)).toEqual([sessions[2].id, sessions[3].id]);
  });

  it('removeOtherSessions removes all except given', () => {
    const { project, sessions } = addProjectWithSessions(4);
    appState.removeOtherSessions(project.id, sessions[1].id);
    expect(appState.activeProject!.sessions).toHaveLength(1);
    expect(appState.activeProject!.sessions[0].id).toBe(sessions[1].id);
  });
});

describe('reorderSession()', () => {
  it('moves session to a different index', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.reorderSession(project.id, sessions[0].id, 2);
    const ids = appState.activeProject!.sessions.map((s) => s.id);
    expect(ids).toEqual([sessions[1].id, sessions[2].id, sessions[0].id]);
  });

  it('no-op when fromIndex === toIndex', () => {
    const { project, sessions } = addProjectWithSessions(3);
    mockSave.mockClear();
    appState.reorderSession(project.id, sessions[1].id, 1);
    expect(mockSave).not.toHaveBeenCalled();
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
});

describe('setSidebarWidth()', () => {
  it('sets sidebarWidth and persists', () => {
    appState.setSidebarWidth(300);
    expect(appState.sidebarWidth).toBe(300);
    expect(mockSave).toHaveBeenCalled();
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

describe('archiveSession via removeSession()', () => {
  it('archives CLI session on close', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'My Session')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-123');
    appState.removeSession(project.id, session.id);
    const history = appState.getSessionHistory(project.id);
    expect(history).toHaveLength(1);
    expect(history[0].name).toBe('My Session');
    expect(history[0].cliSessionId).toBe('cli-123');
    expect(history[0].createdAt).toBe(session.createdAt);
    expect(history[0].closedAt).toBeDefined();
    expect(history[0].providerId).toBe('claude');
  });

  it('captures cost data when available', () => {
    mockCostData();
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    const history = appState.getSessionHistory(project.id);
    expect(history[0].cost).not.toBeNull();
    expect(history[0].cost!.totalCostUsd).toBe(0.42);
    expect(history[0].cost!.totalInputTokens).toBe(1000);
    expect(history[0].cost!.totalOutputTokens).toBe(500);
    expect(history[0].cost!.totalDurationMs).toBe(5000);
  });

  it('archives with null cost when no cost data', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    const history = appState.getSessionHistory(project.id);
    expect(history[0].cost).toBeNull();
  });

  it('does NOT archive diff-viewer sessions', () => {
    const project = addProject();
    const session = appState.addDiffViewerSession(project.id, '/f.ts', 'staged')!;
    appState.removeSession(project.id, session.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(0);
  });

  it('does NOT archive file-reader sessions', () => {
    const project = addProject();
    const session = appState.addFileReaderSession(project.id, '/f.ts')!;
    appState.removeSession(project.id, session.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(0);
  });

  it('does NOT archive mcp-inspector sessions', () => {
    const project = addProject();
    const session = appState.addMcpInspectorSession(project.id, 'Inspector')!;
    appState.removeSession(project.id, session.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(0);
  });

  it('deduplicates by cliSessionId', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-abc');
    appState.removeSession(project.id, session.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(1);

    // Resume and close again
    const resumed = appState.resumeFromHistory(project.id, appState.getSessionHistory(project.id)[0].id)!;
    appState.removeSession(project.id, resumed.id);
    // Should still be 1 entry, not 2
    expect(appState.getSessionHistory(project.id)).toHaveLength(1);
  });

  it('updates cost on deduplicated re-close', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-abc');
    appState.removeSession(project.id, session.id);
    expect(appState.getSessionHistory(project.id)[0].cost).toBeNull();

    // Resume with cost data
    const resumed = appState.resumeFromHistory(project.id, appState.getSessionHistory(project.id)[0].id)!;
    mockCostData();
    appState.removeSession(project.id, resumed.id);
    expect(appState.getSessionHistory(project.id)[0].cost).not.toBeNull();
    expect(appState.getSessionHistory(project.id)[0].cost!.totalCostUsd).toBe(0.42);
  });

  it('updates name on deduplicated re-close', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Original')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-abc');
    appState.removeSession(project.id, session.id);

    const resumed = appState.resumeFromHistory(project.id, appState.getSessionHistory(project.id)[0].id)!;
    appState.renameSession(project.id, resumed.id, 'Renamed');
    appState.removeSession(project.id, resumed.id);
    expect(appState.getSessionHistory(project.id)[0].name).toBe('Renamed');
  });

  it('caps history at 500 entries', () => {
    const project = addProject();
    // Manually set up 500 history entries
    const p = appState.projects.find((p) => p.id === project.id)!;
    p.sessionHistory = [];
    for (let i = 0; i < 500; i++) {
      p.sessionHistory.push({
        id: `old-${i}`,
        name: `Old ${i}`,
        providerId: 'claude',
        cliSessionId: null,
        createdAt: new Date().toISOString(),
        closedAt: new Date().toISOString(),
        cost: null,
      });
    }

    const session = appState.addSession(project.id, 'New')!;
    appState.removeSession(project.id, session.id);
    const history = appState.getSessionHistory(project.id);
    expect(history).toHaveLength(500);
    // Oldest entry should have been dropped
    expect(history[0].id).toBe('old-1');
    expect(history[history.length - 1].name).toBe('New');
  });

  it('emits history-changed on archive', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.removeSession(project.id, session.id);
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('bulk removeAllSessions archives each', () => {
    const { project } = addProjectWithSessions(3);
    appState.removeAllSessions(project.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(3);
  });

  it('does NOT archive when sessionHistoryEnabled is false', () => {
    appState.setPreference('sessionHistoryEnabled', false);
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(0);
  });

  it('preserves existing history when sessionHistoryEnabled is disabled', () => {
    const project = addProject();
    const session1 = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session1.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(1);

    appState.setPreference('sessionHistoryEnabled', false);
    const session2 = appState.addSession(project.id, 'S2')!;
    appState.removeSession(project.id, session2.id);
    // Still 1 — second session was not archived
    expect(appState.getSessionHistory(project.id)).toHaveLength(1);
    expect(appState.getSessionHistory(project.id)[0].name).toBe('S1');
  });

  it('resumes archiving when sessionHistoryEnabled is re-enabled', () => {
    appState.setPreference('sessionHistoryEnabled', false);
    const project = addProject();
    const session1 = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session1.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(0);

    appState.setPreference('sessionHistoryEnabled', true);
    const session2 = appState.addSession(project.id, 'S2')!;
    appState.removeSession(project.id, session2.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(1);
    expect(appState.getSessionHistory(project.id)[0].name).toBe('S2');
  });
});

describe('getSessionHistory()', () => {
  it('returns empty array for project with no history', () => {
    const project = addProject();
    expect(appState.getSessionHistory(project.id)).toEqual([]);
  });

  it('returns empty array for nonexistent project', () => {
    expect(appState.getSessionHistory('nonexistent')).toEqual([]);
  });
});

describe('removeHistoryEntry()', () => {
  it('removes a single history entry by id', () => {
    const project = addProject();
    const s1 = appState.addSession(project.id, 'S1')!;
    const s2 = appState.addSession(project.id, 'S2')!;
    appState.removeSession(project.id, s1.id);
    appState.removeSession(project.id, s2.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(2);

    appState.removeHistoryEntry(project.id, s1.id);
    const history = appState.getSessionHistory(project.id);
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(s2.id);
  });

  it('no-op for nonexistent project', () => {
    // Should not throw
    appState.removeHistoryEntry('bad-project', 'bad-id');
  });

  it('no-op for nonexistent entry id', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    appState.removeHistoryEntry(project.id, 'nonexistent');
    expect(appState.getSessionHistory(project.id)).toHaveLength(1);
  });

  it('emits history-changed', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.removeHistoryEntry(project.id, session.id);
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('persists after removal', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    mockSave.mockClear();
    appState.removeHistoryEntry(project.id, session.id);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('clearSessionHistory()', () => {
  it('clears all history for a project', () => {
    const { project } = addProjectWithSessions(3);
    appState.removeAllSessions(project.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(3);
    appState.clearSessionHistory(project.id);
    expect(appState.getSessionHistory(project.id)).toEqual([]);
  });

  it('emits history-changed', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.clearSessionHistory(project.id);
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('persists', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.removeSession(project.id, session.id);
    mockSave.mockClear();
    appState.clearSessionHistory(project.id);
    expect(mockSave).toHaveBeenCalled();
  });

  it('no-op for nonexistent project', () => {
    // Should not throw
    appState.clearSessionHistory('nonexistent');
  });
});

describe('resumeFromHistory()', () => {
  it('creates new session from archived entry', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-resume');
    appState.removeSession(project.id, session.id);

    const archived = appState.getSessionHistory(project.id)[0];
    const resumed = appState.resumeFromHistory(project.id, archived.id)!;
    expect(resumed).toBeDefined();
    expect(resumed.cliSessionId).toBe('cli-resume');
    expect(resumed.name).toBe('S1');
    expect(resumed.providerId).toBe('claude');
    expect(resumed.id).not.toBe(session.id); // new id
    expect(resumed.createdAt).toBeDefined(); // has its own createdAt
  });

  it('sets resumed session as active', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-123');
    appState.removeSession(project.id, session.id);

    const archived = appState.getSessionHistory(project.id)[0];
    const resumed = appState.resumeFromHistory(project.id, archived.id)!;
    expect(appState.activeProject!.activeSessionId).toBe(resumed.id);
  });

  it('emits session-added and session-changed', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-123');
    appState.removeSession(project.id, session.id);

    const addedCb = vi.fn();
    const changedCb = vi.fn();
    appState.on('session-added', addedCb);
    appState.on('session-changed', changedCb);

    const archived = appState.getSessionHistory(project.id)[0];
    appState.resumeFromHistory(project.id, archived.id);
    expect(addedCb).toHaveBeenCalledTimes(1);
    expect(changedCb).toHaveBeenCalledTimes(1);
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.resumeFromHistory('nonexistent', 'any')).toBeUndefined();
  });

  it('returns undefined for nonexistent archived id', () => {
    const project = addProject();
    expect(appState.resumeFromHistory(project.id, 'nonexistent')).toBeUndefined();
  });

  it('returns undefined when archived session has no cliSessionId', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    // Don't set cliSessionId
    appState.removeSession(project.id, session.id);

    const archived = appState.getSessionHistory(project.id)[0];
    expect(archived.cliSessionId).toBeNull();
    expect(appState.resumeFromHistory(project.id, archived.id)).toBeUndefined();
  });

  it('activates existing tab instead of creating duplicate when cliSessionId matches', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-dup');
    appState.removeSession(project.id, session.id);

    // Resume once — creates a new tab
    const archived = appState.getSessionHistory(project.id)[0];
    const first = appState.resumeFromHistory(project.id, archived.id)!;
    expect(appState.activeProject!.sessions).toHaveLength(1);

    // Add another session to switch away
    appState.addSession(project.id, 'S2');
    expect(appState.activeProject!.activeSessionId).not.toBe(first.id);

    // Resume same history entry again — should activate existing tab, not create a new one
    const second = appState.resumeFromHistory(project.id, archived.id)!;
    expect(second.id).toBe(first.id);
    expect(appState.activeProject!.sessions).toHaveLength(2); // S1 resumed + S2, not 3
    expect(appState.activeProject!.activeSessionId).toBe(first.id);
  });

  it('does not emit session-added when activating existing tab', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-dup');
    appState.removeSession(project.id, session.id);

    const archived = appState.getSessionHistory(project.id)[0];
    appState.resumeFromHistory(project.id, archived.id);

    const addedCb = vi.fn();
    appState.on('session-added', addedCb);
    appState.resumeFromHistory(project.id, archived.id);
    expect(addedCb).not.toHaveBeenCalled();
  });

  it('persists', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-123');
    appState.removeSession(project.id, session.id);
    mockSave.mockClear();

    const archived = appState.getSessionHistory(project.id)[0];
    appState.resumeFromHistory(project.id, archived.id);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('renameSession() history sync', () => {
  it('updates matching history entry name on rename', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Original')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-sync');
    appState.removeSession(project.id, session.id);

    const resumed = appState.resumeFromHistory(project.id, appState.getSessionHistory(project.id)[0].id)!;
    appState.renameSession(project.id, resumed.id, 'Updated');
    expect(appState.getSessionHistory(project.id)[0].name).toBe('Updated');
  });

  it('emits history-changed on rename', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-sync');
    appState.removeSession(project.id, session.id);

    const resumed = appState.resumeFromHistory(project.id, appState.getSessionHistory(project.id)[0].id)!;
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.renameSession(project.id, resumed.id, 'New Name');
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('does not affect history when session has no cliSessionId', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.renameSession(project.id, session.id, 'Renamed');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('addInsightSnapshot()', () => {
  it('creates insights data if not present and stores snapshot', () => {
    const project = addProject();
    const snapshot = {
      sessionId: 's1',
      timestamp: new Date().toISOString(),
      totalTokens: 30000,
      contextWindowSize: 200000,
      usedPercentage: 15,
    };
    appState.addInsightSnapshot(project.id, snapshot);
    expect(project.insights).toBeDefined();
    expect(project.insights!.initialContextSnapshots).toHaveLength(1);
    expect(project.insights!.initialContextSnapshots[0]).toEqual(snapshot);
  });

  it('appends to existing snapshots', () => {
    const project = addProject();
    const s1 = { sessionId: 's1', timestamp: new Date().toISOString(), totalTokens: 10000, contextWindowSize: 200000, usedPercentage: 5 };
    const s2 = { sessionId: 's2', timestamp: new Date().toISOString(), totalTokens: 20000, contextWindowSize: 200000, usedPercentage: 10 };
    appState.addInsightSnapshot(project.id, s1);
    appState.addInsightSnapshot(project.id, s2);
    expect(project.insights!.initialContextSnapshots).toHaveLength(2);
  });

  it('caps at 50 snapshots, keeping most recent', () => {
    const project = addProject();
    for (let i = 0; i < 55; i++) {
      appState.addInsightSnapshot(project.id, {
        sessionId: `s${i}`,
        timestamp: new Date().toISOString(),
        totalTokens: i * 1000,
        contextWindowSize: 200000,
        usedPercentage: i,
      });
    }
    expect(project.insights!.initialContextSnapshots).toHaveLength(50);
    // Should keep the last 50 (indices 5–54)
    expect(project.insights!.initialContextSnapshots[0].sessionId).toBe('s5');
    expect(project.insights!.initialContextSnapshots[49].sessionId).toBe('s54');
  });

  it('persists after adding snapshot', () => {
    const project = addProject();
    mockSave.mockClear();
    appState.addInsightSnapshot(project.id, {
      sessionId: 's1', timestamp: '', totalTokens: 0, contextWindowSize: 200000, usedPercentage: 0,
    });
    expect(mockSave).toHaveBeenCalled();
  });

  it('emits insights-changed event', () => {
    const project = addProject();
    const cb = vi.fn();
    appState.on('insights-changed', cb);
    appState.addInsightSnapshot(project.id, {
      sessionId: 's1', timestamp: '', totalTokens: 0, contextWindowSize: 200000, usedPercentage: 0,
    });
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('no-op for nonexistent project', () => {
    mockSave.mockClear();
    appState.addInsightSnapshot('nonexistent', {
      sessionId: 's1', timestamp: '', totalTokens: 0, contextWindowSize: 200000, usedPercentage: 0,
    });
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('preserves dismissed list when adding snapshots', () => {
    const project = addProject();
    appState.dismissInsight(project.id, 'some-insight');
    appState.addInsightSnapshot(project.id, {
      sessionId: 's1', timestamp: '', totalTokens: 0, contextWindowSize: 200000, usedPercentage: 0,
    });
    expect(project.insights!.dismissed).toContain('some-insight');
  });
});

describe('dismissInsight()', () => {
  it('adds insightId to dismissed list', () => {
    const project = addProject();
    appState.dismissInsight(project.id, 'big-initial-context');
    expect(project.insights!.dismissed).toContain('big-initial-context');
  });

  it('creates insights data if not present', () => {
    const project = addProject();
    expect(project.insights).toBeUndefined();
    appState.dismissInsight(project.id, 'test-insight');
    expect(project.insights).toBeDefined();
    expect(project.insights!.initialContextSnapshots).toEqual([]);
  });

  it('does not add duplicate dismissals', () => {
    const project = addProject();
    appState.dismissInsight(project.id, 'big-initial-context');
    appState.dismissInsight(project.id, 'big-initial-context');
    expect(project.insights!.dismissed.filter(d => d === 'big-initial-context')).toHaveLength(1);
  });

  it('persists after dismissal', () => {
    const project = addProject();
    mockSave.mockClear();
    appState.dismissInsight(project.id, 'test');
    expect(mockSave).toHaveBeenCalled();
  });

  it('emits insights-changed event', () => {
    const project = addProject();
    const cb = vi.fn();
    appState.on('insights-changed', cb);
    appState.dismissInsight(project.id, 'test');
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('no-op for nonexistent project', () => {
    mockSave.mockClear();
    appState.dismissInsight('nonexistent', 'test');
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('can dismiss multiple different insights', () => {
    const project = addProject();
    appState.dismissInsight(project.id, 'insight-a');
    appState.dismissInsight(project.id, 'insight-b');
    expect(project.insights!.dismissed).toEqual(['insight-a', 'insight-b']);
  });
});

describe('isInsightDismissed()', () => {
  it('returns true for dismissed insight', () => {
    const project = addProject();
    appState.dismissInsight(project.id, 'big-initial-context');
    expect(appState.isInsightDismissed(project.id, 'big-initial-context')).toBe(true);
  });

  it('returns false for non-dismissed insight', () => {
    const project = addProject();
    expect(appState.isInsightDismissed(project.id, 'big-initial-context')).toBe(false);
  });

  it('returns false for nonexistent project', () => {
    expect(appState.isInsightDismissed('nonexistent', 'big-initial-context')).toBe(false);
  });

  it('returns false for project with no insights data', () => {
    const project = addProject();
    expect(project.insights).toBeUndefined();
    expect(appState.isInsightDismissed(project.id, 'anything')).toBe(false);
  });
});
