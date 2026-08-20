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

import { appState, _resetForTesting as resetAppState } from './state';
import { applyCliSessionName } from './session-title';

beforeEach(() => {
  // Restore spies: a second vi.spyOn of an already-spied method returns the
  // existing spy, so call counts would leak between tests.
  vi.restoreAllMocks();
  resetAppState();
  uuidCounter = 0;
});

function addProjectAndSession(sessionName = 'Session 1') {
  appState.addProject('Test', '/test');
  const project = appState.activeProject!;
  const session = appState.addSession(project.id, sessionName)!;
  return { project, session };
}

function nameOf(projectId: string, sessionId: string): string {
  const project = appState.projects.find((p) => p.id === projectId)!;
  return project.sessions.find((s) => s.id === sessionId)!.name;
}

describe('applyCliSessionName', () => {
  it('adopts the CLI title as the tab name', () => {
    const { project, session } = addProjectAndSession();
    applyCliSessionName(session.id, 'Remove time frame limitation');
    expect(nameOf(project.id, session.id)).toBe('Remove time frame limitation');
  });

  it('trims surrounding whitespace', () => {
    const { project, session } = addProjectAndSession();
    applyCliSessionName(session.id, '  Fix the flaky test \n');
    expect(nameOf(project.id, session.id)).toBe('Fix the flaky test');
  });

  it('ignores an empty or whitespace-only name', () => {
    const { project, session } = addProjectAndSession();
    applyCliSessionName(session.id, '   ');
    expect(nameOf(project.id, session.id)).toBe('Session 1');
  });

  it('does not overwrite a name the user set in Vibeyard', () => {
    const { project, session } = addProjectAndSession();
    appState.renameSession(project.id, session.id, 'my careful name', true);

    applyCliSessionName(session.id, 'An AI-generated title');

    expect(nameOf(project.id, session.id)).toBe('my careful name');
  });

  it('does nothing when auto-titling is disabled', () => {
    const { project, session } = addProjectAndSession();
    appState.setPreference('autoTitleEnabled', false);

    applyCliSessionName(session.id, 'An AI-generated title');

    expect(nameOf(project.id, session.id)).toBe('Session 1');
  });

  it('truncates to the maximum session name length', () => {
    const { project, session } = addProjectAndSession();
    applyCliSessionName(session.id, 'x'.repeat(200));
    expect(nameOf(project.id, session.id)).toHaveLength(60);
  });

  it('applies a repeated identical name only once', () => {
    const { project, session } = addProjectAndSession();
    const spy = vi.spyOn(appState, 'renameSession');

    applyCliSessionName(session.id, 'Same title');
    applyCliSessionName(session.id, 'Same title');
    applyCliSessionName(session.id, 'Same title');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(nameOf(project.id, session.id)).toBe('Same title');
  });

  it('applies a changed name', () => {
    const { project, session } = addProjectAndSession();
    applyCliSessionName(session.id, 'First title');
    applyCliSessionName(session.id, 'Second title');
    expect(nameOf(project.id, session.id)).toBe('Second title');
  });

  it('ignores a title belonging to a different CLI session', () => {
    // A stale .name survives /clear until the next statusLine render deletes
    // it; resyncAllSessions re-reads every file on window activate.
    const { project, session } = addProjectAndSession();
    appState.updateSessionCliId(project.id, session.id, 'cli-new');

    applyCliSessionName(session.id, 'Title from the cleared conversation', 'cli-old');

    expect(nameOf(project.id, session.id)).toBe('Session 1');
  });

  it('applies a title matching the current CLI session', () => {
    const { project, session } = addProjectAndSession();
    appState.updateSessionCliId(project.id, session.id, 'cli-new');

    applyCliSessionName(session.id, 'Current title', 'cli-new');

    expect(nameOf(project.id, session.id)).toBe('Current title');
  });

  it('applies a title when the session has no CLI id yet', () => {
    const { project, session } = addProjectAndSession();
    applyCliSessionName(session.id, 'Early title', 'cli-1');
    expect(nameOf(project.id, session.id)).toBe('Early title');
  });

  it('is a no-op for an unknown session id', () => {
    addProjectAndSession();
    expect(() => applyCliSessionName('does-not-exist', 'Title')).not.toThrow();
  });

  it('re-applies a name after the tab is reset (e.g. /clear)', () => {
    const { project, session } = addProjectAndSession();
    applyCliSessionName(session.id, 'Same title');
    appState.renameSession(project.id, session.id, 'Session 2');

    applyCliSessionName(session.id, 'Same title');

    expect(nameOf(project.id, session.id)).toBe('Same title');
  });

  it('applies an over-long title only once', () => {
    // The dedupe compares against the stored name, which renameSession
    // truncates — so it must compare against the truncated form too.
    const { project, session } = addProjectAndSession();
    const spy = vi.spyOn(appState, 'renameSession');
    const long = 'y'.repeat(200);

    applyCliSessionName(session.id, long);
    applyCliSessionName(session.id, long);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(nameOf(project.id, session.id)).toHaveLength(60);
  });
});
