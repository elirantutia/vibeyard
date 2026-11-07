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

vi.mock('../session-cost.js', () => ({
  getCost: vi.fn().mockReturnValue(null),
  restoreCost: vi.fn(),
}));

vi.mock('../session-context.js', () => ({
  restoreContext: vi.fn(),
}));

vi.mock('../provider-availability.js', () => ({
  getProviderCapabilities: vi.fn(() => null),
  getProviderAvailabilitySnapshot: vi.fn(() => null),
  getTeamChatProviderMetas: vi.fn(() => []),
}));

import { appState, _resetForTesting } from '../state';
import { getCost } from '../session-cost.js';
const mockGetCost = vi.mocked(getCost);

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
  appState.toggleSwarm();
  const sessions = [];
  for (let i = 0; i < count; i++) {
    sessions.push(appState.addSession(project.id, `Session ${i + 1}`)!);
  }
  return { project, sessions };
}

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

