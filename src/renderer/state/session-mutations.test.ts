import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: mockLoad, save: mockSave },
    session: { transcriptExistsSync: vi.fn().mockReturnValue(true) },
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

import { appState, _resetForTesting, MAX_SESSION_NAME_LENGTH } from '../state';
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
    vi.useFakeTimers();
    try {
      const project = addProject();
      const session = appState.addSession(project.id, 'S1')!;
      mockSave.mockClear();
      appState.updateSessionCost(session.id, sampleCost);
      const updated = appState.activeProject!.sessions.find(s => s.id === session.id)!;
      expect(updated.cost).toEqual(sampleCost);
      vi.advanceTimersByTime(1000);
      expect(mockSave).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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
    vi.useFakeTimers();
    try {
      const project = addProject();
      const session = appState.addSession(project.id, 'S1')!;
      mockSave.mockClear();
      appState.updateSessionContext(session.id, sampleContext);
      const updated = appState.activeProject!.sessions.find(s => s.id === session.id)!;
      expect(updated.contextWindow).toEqual(sampleContext);
      vi.advanceTimersByTime(1000);
      expect(mockSave).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

