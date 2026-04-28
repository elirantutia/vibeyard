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

import { appState, _resetForTesting, MAX_SESSION_NAME_LENGTH, MAX_PROJECT_NAME_LENGTH } from './state';
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
    // default mode is swarm, so splitPanes are auto-populated
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

  it('resets userRenamed when cliSessionId changes', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'claude-abc');
    appState.renameSession(project.id, session.id, 'Custom', true);
    expect(appState.activeSession!.userRenamed).toBe(true);
    // Simulate /clear: new cliSessionId
    appState.updateSessionCliId(project.id, session.id, 'claude-xyz');
    expect(appState.activeSession!.userRenamed).toBe(false);
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

  it('sets userRenamed when passed true', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Old')!;
    appState.renameSession(project.id, session.id, 'Manual', true);
    expect(appState.activeSession!.userRenamed).toBe(true);
  });

  it('does not set userRenamed when param omitted', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Old')!;
    appState.renameSession(project.id, session.id, 'Auto');
    expect(appState.activeSession!.userRenamed).toBeUndefined();
  });

  it('truncates name exceeding MAX_SESSION_NAME_LENGTH', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Old')!;
    const longName = 'A'.repeat(MAX_SESSION_NAME_LENGTH + 40);
    appState.renameSession(project.id, session.id, longName);
    expect(appState.activeSession!.name).toBe('A'.repeat(MAX_SESSION_NAME_LENGTH));
  });

  it('refuses to rename a kanban session', () => {
    const project = addProject('My Project');
    const kanban = appState.openKanbanTab(project.id)!;
    appState.renameSession(project.id, kanban.id, 'Custom', true);
    expect(kanban.name).toBe('My Project - Kanban');
    expect(kanban.userRenamed).toBeUndefined();
  });

  it('refuses to rename a project-tab session', () => {
    const project = addProject('My Project');
    const overview = appState.openProjectTab(project.id)!;
    appState.renameSession(project.id, overview.id, 'Custom', true);
    expect(overview.name).toBe('My Project - Overview');
    expect(overview.userRenamed).toBeUndefined();
  });
});

describe('openKanbanTab()', () => {
  it('creates a kanban session with locked name', () => {
    const project = addProject('Acme');
    const session = appState.openKanbanTab(project.id)!;
    expect(session.type).toBe('kanban');
    expect(session.name).toBe('Acme - Kanban');
    expect(project.activeSessionId).toBe(session.id);
  });

  it('reuses an existing kanban session instead of creating a duplicate', () => {
    const project = addProject('Acme');
    const first = appState.openKanbanTab(project.id)!;
    const second = appState.openKanbanTab(project.id)!;
    expect(second.id).toBe(first.id);
    expect(project.sessions.filter((s) => s.type === 'kanban')).toHaveLength(1);
  });
});

describe('openProjectTab()', () => {
  it('creates a project-tab session named "<project> - Overview"', () => {
    const project = addProject('Acme');
    const session = appState.openProjectTab(project.id)!;
    expect(session.type).toBe('project-tab');
    expect(session.name).toBe('Acme - Overview');
  });
});

describe('toggleSplit() / toggleSwarm()', () => {
  it('switches from swarm to tabs and preserves splitPanes', () => {
    addProjectWithSessions(3);
    // default mode is swarm with sessions auto-populated
    expect(appState.activeProject!.layout.mode).toBe('swarm');
    expect(appState.activeProject!.layout.splitPanes.length).toBe(3);
    const panesBefore = [...appState.activeProject!.layout.splitPanes];
    appState.toggleSwarm(); // swarm -> tabs
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('tabs');
    expect(layout.splitPanes).toEqual(panesBefore);
  });

  it('switches from tabs back to swarm and populates splitPanes', () => {
    const { project, sessions } = addProjectWithSessions(2);
    appState.toggleSwarm(); // swarm -> tabs
    appState.toggleSwarm(); // tabs -> swarm
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('swarm');
    expect(layout.splitPanes.length).toBe(2);
  });

  it('toggleSplit delegates to toggleSwarm', () => {
    addProjectWithSessions(2);
    appState.toggleSplit(); // swarm -> tabs
    expect(appState.activeProject!.layout.mode).toBe('tabs');
  });

  it('emits layout-changed', () => {
    addProjectWithSessions(2);
    const cb = vi.fn();
    appState.on('layout-changed', cb);
    appState.toggleSwarm();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('includes all CLI sessions in splitPanes by default', () => {
    addProjectWithSessions(8);
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('swarm');
    expect(layout.splitPanes.length).toBe(8);
  });

  it('starts in swarm with a single CLI session', () => {
    addProjectWithSessions(1);
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('swarm');
    expect(layout.splitPanes.length).toBe(1);
  });

  it('stays in swarm when removing sessions down to 1 pane', () => {
    const { project, sessions } = addProjectWithSessions(2);
    // already in swarm mode by default
    appState.removeSession(project.id, sessions[0].id);
    const layout = appState.activeProject!.layout;
    expect(layout.mode).toBe('swarm');
    expect(layout.splitPanes.length).toBe(1);
  });

  it('places activeSessionId first in splitPanes when toggling to swarm', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.toggleSwarm(); // swarm -> tabs
    appState.setActiveSession(project.id, sessions[0].id);
    appState.toggleSwarm(); // tabs -> swarm
    expect(appState.activeProject!.layout.splitPanes[0]).toBe(sessions[0].id);
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

describe('reorderProject()', () => {
  it('moves project forward', () => {
    const a = appState.addProject('A', '/a');
    const b = appState.addProject('B', '/b');
    const c = appState.addProject('C', '/c');
    appState.reorderProject(0, 2);
    expect(appState.projects.map(p => p.id)).toEqual([b.id, c.id, a.id]);
  });

  it('moves project backward', () => {
    const a = appState.addProject('A', '/a');
    const b = appState.addProject('B', '/b');
    const c = appState.addProject('C', '/c');
    appState.reorderProject(2, 0);
    expect(appState.projects.map(p => p.id)).toEqual([c.id, a.id, b.id]);
  });

  it('no-op when fromIndex === toIndex', () => {
    appState.addProject('A', '/a');
    appState.addProject('B', '/b');
    mockSave.mockClear();
    appState.reorderProject(1, 1);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('no-op when index is out of range', () => {
    appState.addProject('A', '/a');
    appState.addProject('B', '/b');
    mockSave.mockClear();
    appState.reorderProject(0, 5);
    appState.reorderProject(-1, 0);
    appState.reorderProject(5, 0);
    expect(mockSave).not.toHaveBeenCalled();
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

  it('syncs splitPanes order when reordering sessions', () => {
    const { project, sessions } = addProjectWithSessions(3);
    // already in swarm mode by default
    const panesBefore = [...appState.activeProject!.layout.splitPanes];
    expect(panesBefore).toContain(sessions[0].id);
    expect(panesBefore).toContain(sessions[1].id);
    expect(panesBefore).toContain(sessions[2].id);

    // Move first session to last position
    appState.reorderSession(project.id, sessions[0].id, 2);
    const panesAfter = appState.activeProject!.layout.splitPanes;
    const sessionIds = appState.activeProject!.sessions.map(s => s.id);
    // splitPanes should follow sessions order
    expect(panesAfter).toEqual(sessionIds);
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

  it('archives Copilot sessions once a cliSessionId is available', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Copilot Session', undefined, 'copilot')!;
    appState.updateSessionCliId(project.id, session.id, 'copilot-cli-123');
    appState.removeSession(project.id, session.id);
    const history = appState.getSessionHistory(project.id);
    expect(history).toHaveLength(1);
    expect(history[0].name).toBe('Copilot Session');
    expect(history[0].providerId).toBe('copilot');
    expect(history[0].cliSessionId).toBe('copilot-cli-123');
  });

  it('captures cost data when available', () => {
    mockCostData();
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-cost');
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
    appState.updateSessionCliId(project.id, session.id, 'cli-no-cost');
    appState.removeSession(project.id, session.id);
    const history = appState.getSessionHistory(project.id);
    expect(history[0].cost).toBeNull();
  });

  it('does NOT archive empty sessions (no cliSessionId, no cost)', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'Empty')!;
    appState.removeSession(project.id, session.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(0);
  });

  it('archives session with cost data but no cliSessionId', () => {
    mockCostData();
    const project = addProject();
    const session = appState.addSession(project.id, 'CostOnly')!;
    appState.removeSession(project.id, session.id);
    const history = appState.getSessionHistory(project.id);
    expect(history).toHaveLength(1);
    expect(history[0].cliSessionId).toBeNull();
    expect(history[0].cost).not.toBeNull();
    expect(history[0].cost!.totalCostUsd).toBe(0.42);
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
    appState.updateSessionCliId(project.id, session.id, 'cli-new');
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
    appState.updateSessionCliId(project.id, session.id, 'cli-emit');
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.removeSession(project.id, session.id);
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('bulk removeAllSessions archives each', () => {
    const { project, sessions } = addProjectWithSessions(3);
    sessions.forEach((s, i) => appState.updateSessionCliId(project.id, s.id, `cli-bulk-${i}`));
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
    appState.updateSessionCliId(project.id, session1.id, 'cli-preserve');
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
    appState.updateSessionCliId(project.id, session2.id, 'cli-resume-pref');
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
    appState.updateSessionCliId(project.id, s1.id, 'cli-s1');
    appState.updateSessionCliId(project.id, s2.id, 'cli-s2');
    appState.removeSession(project.id, s1.id);
    appState.removeSession(project.id, s2.id);
    const historyBefore = appState.getSessionHistory(project.id);
    expect(historyBefore).toHaveLength(2);

    const entryToRemove = historyBefore.find(h => h.name === 'S1')!;
    appState.removeHistoryEntry(project.id, entryToRemove.id);
    const history = appState.getSessionHistory(project.id);
    expect(history).toHaveLength(1);
    expect(history[0].name).toBe('S2');
  });

  it('no-op for nonexistent project', () => {
    // Should not throw
    appState.removeHistoryEntry('bad-project', 'bad-id');
  });

  it('no-op for nonexistent entry id', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-noop');
    appState.removeSession(project.id, session.id);
    appState.removeHistoryEntry(project.id, 'nonexistent');
    expect(appState.getSessionHistory(project.id)).toHaveLength(1);
  });

  it('emits history-changed', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-emit-hist');
    appState.removeSession(project.id, session.id);
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.removeHistoryEntry(project.id, session.id);
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('persists after removal', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-persist');
    appState.removeSession(project.id, session.id);
    mockSave.mockClear();
    appState.removeHistoryEntry(project.id, session.id);
    expect(mockSave).toHaveBeenCalled();
  });
});

describe('clearSessionHistory()', () => {
  it('clears all history for a project', () => {
    const { project, sessions } = addProjectWithSessions(3);
    sessions.forEach((s, i) => appState.updateSessionCliId(project.id, s.id, `cli-clear-${i}`));
    appState.removeAllSessions(project.id);
    expect(appState.getSessionHistory(project.id)).toHaveLength(3);
    appState.clearSessionHistory(project.id);
    expect(appState.getSessionHistory(project.id)).toEqual([]);
  });

  it('emits history-changed', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-clear-emit');
    appState.removeSession(project.id, session.id);
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.clearSessionHistory(project.id);
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('persists', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-clear-persist');
    appState.removeSession(project.id, session.id);
    mockSave.mockClear();
    appState.clearSessionHistory(project.id);
    expect(mockSave).toHaveBeenCalled();
  });

  it('no-op for nonexistent project', () => {
    // Should not throw
    appState.clearSessionHistory('nonexistent');
  });

  it('preserves bookmarked sessions when clearing', () => {
    const { project, sessions } = addProjectWithSessions(3);
    sessions.forEach((s, i) => appState.updateSessionCliId(project.id, s.id, `cli-bm-clear-${i}`));
    appState.removeAllSessions(project.id);
    const historyBefore = appState.getSessionHistory(project.id);
    expect(historyBefore).toHaveLength(3);

    const entryToBookmark = historyBefore.find(h => h.name === sessions[1].name)!;
    appState.toggleBookmark(project.id, entryToBookmark.id);
    appState.clearSessionHistory(project.id);
    const remaining = appState.getSessionHistory(project.id);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe(sessions[1].name);
    expect(remaining[0].bookmarked).toBe(true);
  });
});

describe('toggleBookmark()', () => {
  it('toggles bookmark on a history entry', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-bm-toggle');
    appState.removeSession(project.id, session.id);

    const entry = appState.getSessionHistory(project.id)[0];
    expect(entry.bookmarked).toBeFalsy();

    appState.toggleBookmark(project.id, entry.id);
    expect(appState.getSessionHistory(project.id)[0].bookmarked).toBe(true);

    appState.toggleBookmark(project.id, entry.id);
    expect(appState.getSessionHistory(project.id)[0].bookmarked).toBe(false);
  });

  it('emits history-changed', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-bm-emit');
    appState.removeSession(project.id, session.id);
    const entry = appState.getSessionHistory(project.id)[0];
    const cb = vi.fn();
    appState.on('history-changed', cb);
    appState.toggleBookmark(project.id, entry.id);
    expect(cb).toHaveBeenCalledWith(project.id);
  });

  it('persists after toggling', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-bm-persist');
    appState.removeSession(project.id, session.id);
    const entry = appState.getSessionHistory(project.id)[0];
    mockSave.mockClear();
    appState.toggleBookmark(project.id, entry.id);
    expect(mockSave).toHaveBeenCalled();
  });

  it('no-op for nonexistent project', () => {
    appState.toggleBookmark('bad-project', 'bad-id');
  });

  it('no-op for nonexistent entry', () => {
    const project = addProject();
    appState.toggleBookmark(project.id, 'nonexistent');
  });

  it('archived entries from same session via /clear get unique IDs', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-first');
    // Simulate /clear: session gets a new CLI session ID, old state is archived
    appState.updateSessionCliId(project.id, session.id, 'cli-second');
    // Close the session — archives again with the new CLI session ID
    appState.removeSession(project.id, session.id);
    const history = appState.getSessionHistory(project.id);
    expect(history).toHaveLength(2);
    // Both entries must have unique IDs
    expect(history[0].id).not.toBe(history[1].id);

    // Bookmarking each entry should only affect that entry
    appState.toggleBookmark(project.id, history[1].id);
    const afterToggle = appState.getSessionHistory(project.id);
    expect(afterToggle[1].bookmarked).toBe(true);
    expect(afterToggle[0].bookmarked).toBeFalsy();
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
    mockCostData(); // need cost data so session gets archived despite no cliSessionId
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

  it('adds resumed session to splitPanes when in swarm mode', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-swarm');
    appState.removeSession(project.id, session.id);

    // Switch to swarm mode
    project.layout.mode = 'swarm';
    project.layout.splitPanes = [];

    const archived = appState.getSessionHistory(project.id)[0];
    const resumed = appState.resumeFromHistory(project.id, archived.id)!;
    expect(resumed).toBeDefined();
    expect(project.layout.splitPanes).toContain(resumed.id);
  });

  it('does not add to splitPanes when in tabs mode', () => {
    const project = addProject();
    const session = appState.addSession(project.id, 'S1')!;
    appState.updateSessionCliId(project.id, session.id, 'cli-tabs');
    appState.removeSession(project.id, session.id);

    project.layout.mode = 'tabs';
    project.layout.splitPanes = [];

    const archived = appState.getSessionHistory(project.id)[0];
    const resumed = appState.resumeFromHistory(project.id, archived.id)!;
    expect(resumed).toBeDefined();
    expect(project.layout.splitPanes).toHaveLength(0);
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

describe('navigateBack()/navigateForward()', () => {
  it('walks backward and forward through visited sessions', () => {
    const { project, sessions } = addProjectWithSessions(3);
    // addSession already pushes each into nav history (S1, S2, S3), active=S3
    expect(project.activeSessionId).toBe(sessions[2].id);

    appState.navigateBack();
    expect(project.activeSessionId).toBe(sessions[1].id);
    appState.navigateBack();
    expect(project.activeSessionId).toBe(sessions[0].id);
    appState.navigateBack();
    expect(project.activeSessionId).toBe(sessions[0].id); // clamped

    appState.navigateForward();
    expect(project.activeSessionId).toBe(sessions[1].id);
    appState.navigateForward();
    expect(project.activeSessionId).toBe(sessions[2].id);
    appState.navigateForward();
    expect(project.activeSessionId).toBe(sessions[2].id); // clamped
  });

  it('truncates the forward stack on a new visit', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.navigateBack();
    appState.navigateBack();
    expect(project.activeSessionId).toBe(sessions[0].id);

    appState.setActiveSession(project.id, sessions[2].id);
    // Forward stack should be cleared; navigateForward is now a no-op
    appState.navigateForward();
    expect(project.activeSessionId).toBe(sessions[2].id);

    appState.navigateBack();
    expect(project.activeSessionId).toBe(sessions[0].id);
  });

  it('skips sessions removed from history', () => {
    const { project, sessions } = addProjectWithSessions(3);
    // active=S3, history=[S1,S2,S3]
    appState.removeSession(project.id, sessions[1].id);
    // S2 pruned. History=[S1,S3], active=S3.
    appState.navigateBack();
    expect(project.activeSessionId).toBe(sessions[0].id);
  });

  it('navigates across projects', () => {
    const projectA = addProject('A', '/a');
    const sA = appState.addSession(projectA.id, 'A1')!;
    const projectB = addProject('B', '/b');
    const sB = appState.addSession(projectB.id, 'B1')!;

    expect(appState.activeProjectId).toBe(projectB.id);
    appState.navigateBack();
    expect(appState.activeProjectId).toBe(projectA.id);
    expect(projectA.activeSessionId).toBe(sA.id);

    appState.navigateForward();
    expect(appState.activeProjectId).toBe(projectB.id);
    expect(projectB.activeSessionId).toBe(sB.id);
  });

  it('does not re-push during back/forward navigation', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.navigateBack();
    appState.navigateBack();
    // Should still be able to walk all the way forward to the original tail
    appState.navigateForward();
    appState.navigateForward();
    expect(project.activeSessionId).toBe(sessions[2].id);
  });

  it('prunes a removed session from nav history without corrupting preceding entries', () => {
    const { project, sessions } = addProjectWithSessions(3);
    appState.removeSession(project.id, sessions[2].id);
    appState.navigateBack();
    expect(appState.activeProject!.activeSessionId).toBe(sessions[0].id);
  });
});

describe('setProjectReadiness()', () => {
  it('sets readiness on the project, persists, and emits readiness-changed', () => {
    const project = addProject();
    const cb = vi.fn();
    appState.on('readiness-changed', cb);
    const result = { ready: true, details: {} } as unknown as Parameters<typeof appState.setProjectReadiness>[1];
    appState.setProjectReadiness(project.id, result);
    expect(project.readiness).toBe(result);
    expect(cb).toHaveBeenCalledWith(project.id);
    expect(mockSave).toHaveBeenCalled();
  });

  it('is a no-op for unknown projectId', () => {
    const cb = vi.fn();
    appState.on('readiness-changed', cb);
    appState.setProjectReadiness('missing', {} as Parameters<typeof appState.setProjectReadiness>[1]);
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('toggleSwarm() sync new CLI sessions', () => {
  it('adds sessions created while in tabs mode to splitPanes when toggling back to swarm', () => {
    const { project, sessions } = addProjectWithSessions(2);
    appState.toggleSwarm();
    expect(appState.activeProject!.layout.mode).toBe('tabs');
    const newSession = appState.addSession(project.id, 'extra')!;
    expect(appState.activeProject!.layout.splitPanes).not.toContain(newSession.id);
    appState.toggleSwarm();
    expect(appState.activeProject!.layout.splitPanes).toContain(newSession.id);
  });
});

describe('openCliSession()', () => {
  it('creates a new session with the given cliSessionId', () => {
    const project = addProject();
    const session = appState.openCliSession(project.id, 'cli-abc-123', 'My Session')!;
    expect(session).toBeDefined();
    expect(session.cliSessionId).toBe('cli-abc-123');
    expect(session.name).toBe('My Session');
    expect(session.providerId).toBe('claude');
  });

  it('sets the new session as active', () => {
    const project = addProject();
    const session = appState.openCliSession(project.id, 'cli-abc-123', 'My Session')!;
    expect(appState.activeProject!.activeSessionId).toBe(session.id);
  });

  it('activates existing tab when cliSessionId already open', () => {
    const project = addProject();
    const first = appState.openCliSession(project.id, 'cli-same', 'Session A')!;
    appState.addSession(project.id, 'Other');
    expect(appState.activeProject!.activeSessionId).not.toBe(first.id);

    const second = appState.openCliSession(project.id, 'cli-same', 'Session A')!;
    expect(second.id).toBe(first.id);
    expect(appState.activeProject!.sessions).toHaveLength(2); // no duplicate created
  });

  it('emits session-added for new session', () => {
    const project = addProject();
    const addedCb = vi.fn();
    appState.on('session-added', addedCb);
    appState.openCliSession(project.id, 'cli-xyz', 'S');
    expect(addedCb).toHaveBeenCalledTimes(1);
  });

  it('does not emit session-added when activating existing tab', () => {
    const project = addProject();
    appState.openCliSession(project.id, 'cli-dup', 'S');
    const addedCb = vi.fn();
    appState.on('session-added', addedCb);
    appState.openCliSession(project.id, 'cli-dup', 'S');
    expect(addedCb).not.toHaveBeenCalled();
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.openCliSession('no-such-project', 'cli-123', 'S')).toBeUndefined();
  });

  it('persists state after opening session', () => {
    const project = addProject();
    mockSave.mockClear();
    appState.openCliSession(project.id, 'cli-persist', 'S');
    expect(mockSave).toHaveBeenCalled();
  });

  it('appends to swarm splitPanes when in swarm mode', () => {
    const project = addProject();
    // swarm mode is the default layout mode
    const session = appState.openCliSession(project.id, 'cli-swarm', 'S')!;
    expect(appState.activeProject!.layout.splitPanes).toContain(session.id);
  });
});

describe('addPlanSession()', () => {
  it('uses providerIdOverride when provided', () => {
    const project = addProject();
    const session = appState.addPlanSession(project.id, 'Plan', true, 'copilot')!;
    expect(session.providerId).toBe('copilot');
  });

  it('providerIdOverride wins over preferences.defaultProvider', () => {
    appState.setPreference('defaultProvider', 'gemini');
    const project = addProject();
    const session = appState.addPlanSession(project.id, 'Plan', true, 'copilot')!;
    expect(session.providerId).toBe('copilot');
  });

  it('falls back to preferences.defaultProvider when override absent', () => {
    appState.setPreference('defaultProvider', 'gemini');
    const project = addProject();
    const session = appState.addPlanSession(project.id, 'Plan', true)!;
    expect(session.providerId).toBe('gemini');
  });

  it('returns undefined for nonexistent project', () => {
    expect(appState.addPlanSession('no-such-project', 'Plan', true, 'claude')).toBeUndefined();
  });
});
