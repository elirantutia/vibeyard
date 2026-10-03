import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: vi.fn(), save: vi.fn() },
    session: { transcriptExistsSync: vi.fn(() => false) },
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
  getProviderCapabilities: vi.fn(),
}));

import { appState, _resetForTesting } from './state';
import { addTask, updateTask, getBoard, getColumnByBehavior, getTaskBySessionId } from './board-state';
import { initBoardSessionSync } from './board-session-sync';
import { _resetForTesting as resetActivity, setHookStatus, initSession } from './session-activity';

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  _resetForTesting();
  resetActivity();

  const project = appState.addProject('Test', '/test');
  project.board = {
    columns: [
      { id: 'col-backlog', title: 'Backlog', order: 0, behavior: 'inbox' as const },
      { id: 'col-ready', title: 'Ready', order: 1, behavior: 'none' as const },
      { id: 'col-running', title: 'Running', order: 2, behavior: 'active' as const },
      { id: 'col-done', title: 'Done', order: 3, behavior: 'terminal' as const },
    ],
    tasks: [],
  };

  // Re-register listeners each time since _resetForTesting clears them
  initBoardSessionSync();
});

describe('board-session-sync', () => {
  it('moves task to Done when session status becomes completed', () => {
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-running' })!;
    const sessionId = 'sess-1';
    updateTask(task.id, { sessionId });
    initSession(sessionId);

    // Simulate status change to completed
    setHookStatus(sessionId, 'completed');

    const updated = getBoard()!.tasks.find(t => t.id === task.id);
    expect(updated!.columnId).toBe('col-done');
  });

  it('keeps unfinished task in its column when session is removed', () => {
    const project = appState.activeProject!;
    const session = appState.addSession(project.id, 'Test Session')!;
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-running' })!;
    updateTask(task.id, { sessionId: session.id });

    appState.removeSession(project.id, session.id);

    const updated = getBoard()!.tasks.find(t => t.id === task.id);
    expect(updated!.columnId).toBe('col-running');
  });

  it('clears sessionId when session is removed', () => {
    const project = appState.activeProject!;
    const session = appState.addSession(project.id, 'Test Session')!;
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-running' })!;
    updateTask(task.id, { sessionId: session.id });

    appState.removeSession(project.id, session.id);

    const updated = getBoard()!.tasks.find(t => t.id === task.id);
    expect(updated!.sessionId).toBeUndefined();
  });

  it('does not create duplicate moves for already-done tasks', () => {
    const task = addTask({ title: 'T', prompt: 'p', columnId: 'col-done' })!;
    const sessionId = 'sess-1';
    updateTask(task.id, { sessionId });
    initSession(sessionId);

    setHookStatus(sessionId, 'completed');

    // Task should still be in done with order 0 (no duplicate move)
    const updated = getBoard()!.tasks.find(t => t.id === task.id);
    expect(updated!.columnId).toBe('col-done');
  });

  it('persists cliSessionId on task when session gets one', () => {
    const project = appState.activeProject!;
    const session = appState.addSession(project.id, 'Test Session')!;
    const task = addTask({ title: 'T', prompt: 'p' })!;
    updateTask(task.id, { sessionId: session.id });

    // Simulate CLI session ID assignment
    appState.updateSessionCliId(project.id, session.id, 'cli-abc');

    const updated = getBoard()!.tasks.find(t => t.id === task.id);
    expect(updated!.cliSessionId).toBe('cli-abc');
  });

  it('updates a background project on completion and removal', () => {
    const first = appState.activeProject!;
    const session = appState.addSession(first.id, 'Background')!;
    const task = addTask({ title: 'Background task', columnId: 'col-running' })!;
    updateTask(task.id, { sessionId: session.id });
    const second = appState.addProject('Other', '/other');
    second.board = { columns: [{ id: 'other', title: 'Other', order: 0, behavior: 'inbox' }], tasks: [] };
    appState.setActiveProject(second.id);

    appState.updateSessionCliId(first.id, session.id, 'cli-background');
    expect(getBoard(first.id)!.tasks[0].cliSessionId).toBe('cli-background');
    initSession(session.id);
    setHookStatus(session.id, 'completed');
    expect(getBoard(first.id)!.tasks[0].columnId).toBe('col-done');
    appState.removeSession(first.id, session.id);
    expect(getBoard(first.id)!.tasks[0].sessionId).toBeUndefined();
  });
});


