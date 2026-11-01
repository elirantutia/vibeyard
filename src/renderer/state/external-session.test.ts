import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: vi.fn(), save: vi.fn() },
    session: { transcriptExistsSync: vi.fn().mockReturnValue(true) },
  },
});
let uuidCounter = 0;
vi.stubGlobal('crypto', { randomUUID: () => `uuid-${++uuidCounter}` });
vi.mock('../session-cost.js', () => ({ getCost: vi.fn().mockReturnValue(null), restoreCost: vi.fn() }));
vi.mock('../session-context.js', () => ({ restoreContext: vi.fn() }));
vi.mock('../provider-availability.js', () => ({
  getProviderCapabilities: vi.fn(() => null),
  getProviderAvailabilitySnapshot: vi.fn(() => null),
  getTeamChatProviderMetas: vi.fn(() => []),
}));

import { appState, _resetForTesting, MAX_SESSION_NAME_LENGTH } from '../state';

beforeEach(() => { uuidCounter = 0; _resetForTesting(); });

function setup() {
  const project = appState.addProject('P', '/p')!;
  const tl = appState.addSession(project.id, 'TL')!;
  return { project, tl };
}

describe('addExternalSession', () => {
  it('creates a sticky-named session owned by the caller, without stealing the active tab', () => {
    const { project, tl } = setup();
    const s = appState.addExternalSession(project.id, { name: 'DR-1 bug', createdBy: tl.id, focus: false, initialPrompt: 'go' })!;
    expect(s.name).toBe('DR-1 bug');
    expect(s.userRenamed).toBe(true);
    expect(s.createdBy).toBe(tl.id);
    expect(project.activeSessionId).toBe(tl.id);
  });

  it('makes the new session active when focus is true', () => {
    const { project, tl } = setup();
    const s = appState.addExternalSession(project.id, { name: 'w', createdBy: tl.id, focus: true })!;
    expect(project.activeSessionId).toBe(s.id);
  });

  it('exposes the initial prompt to session-added listeners synchronously, then consumes it', () => {
    const { project, tl } = setup();
    let seen: string | undefined;
    appState.on('session-added', (d) => {
      const { session } = d as { session: { id: string } };
      seen = appState.consumePendingInitialPrompt(project.id, session.id);
    });
    appState.addExternalSession(project.id, { name: 'w', createdBy: tl.id, focus: false, initialPrompt: 'line1\n"q"' });
    expect(seen).toBe('line1\n"q"');
  });

  it('hands the tab name to session-added listeners as the pending CLI name, then consumes it', () => {
    const { project, tl } = setup();
    let seen: string | undefined;
    let again: string | undefined;
    appState.on('session-added', (d) => {
      const { session } = d as { session: { id: string } };
      seen = appState.consumePendingCliName(project.id, session.id);
      again = appState.consumePendingCliName(project.id, session.id);
    });
    appState.addExternalSession(project.id, { name: 'DR-1 bug "x" $y', createdBy: tl.id, focus: false });
    expect(seen).toBe('DR-1 bug "x" $y');
    expect(again).toBeUndefined();
  });

  it('uses the same (truncated) name for the CLI as for the tab', () => {
    const { project, tl } = setup();
    const s = appState.addExternalSession(project.id, { name: 'x'.repeat(200), createdBy: tl.id, focus: false })!;
    expect(s.pendingCliName).toBe(s.name);
  });

  it('does not set a pending CLI name for a UI-created session', () => {
    const { tl } = setup();
    expect(tl.pendingCliName).toBeUndefined();
  });

  it("always uses the project's saved default args and env (callers cannot pass their own)", () => {
    const { project, tl } = setup();
    project.defaultArgs = '--model opus';
    project.defaultEnv = 'A=1';
    const a = appState.addExternalSession(project.id, { name: 'a', createdBy: tl.id, focus: false })!;
    expect(a.args).toBe('--model opus');
    expect(a.envVars).toBe('A=1');
  });

  it('truncates the name to the shared cap and returns undefined for an unknown project', () => {
    const { project, tl } = setup();
    const s = appState.addExternalSession(project.id, { name: 'x'.repeat(200), createdBy: tl.id, focus: false })!;
    expect(s.name.length).toBe(MAX_SESSION_NAME_LENGTH);
    expect(appState.addExternalSession('nope', { name: 'n', createdBy: tl.id, focus: false })).toBeUndefined();
  });

  it('persists createdBy (not stripped as transient)', () => {
    const { project, tl } = setup();
    appState.addExternalSession(project.id, { name: 'w', createdBy: tl.id, focus: false });
    const saved = (window as any).vibeyard.store.save.mock.calls.at(-1)?.[0];
    const sessions = saved?.projects?.[0]?.sessions ?? [];
    expect(sessions.some((s: { createdBy?: string }) => s.createdBy === tl.id)).toBe(true);
  });

  it('createdBy and the sticky name survive a save → load round trip (app restart)', async () => {
    const { project, tl } = setup();
    const w = appState.addExternalSession(project.id, { name: 'DR-9 worker', createdBy: tl.id, focus: false, initialPrompt: 'go' })!;
    const { serializeForSave } = await import('./persistence.js');
    const saved = JSON.parse(JSON.stringify(serializeForSave((appState as any).state)));
    const restored = saved.projects[0].sessions.find((s: { id: string }) => s.id === w.id);
    expect(restored).toMatchObject({ name: 'DR-9 worker', userRenamed: true, createdBy: tl.id });
    expect(restored.pendingInitialPrompt).toBeUndefined(); // the prompt must not replay on restart
    expect(restored.pendingCliName).toBeUndefined(); // resume keeps Claude's stored name; never re-passed
  });

  describe('into a project that is not the active one', () => {
    function twoProjects() {
      const { project: home, tl } = setup();
      const other = appState.addProject('Q', '/q')!;
      const resident = appState.addSession(other.id, 'R')!;
      appState.setActiveProject(home.id);
      return { home, other, resident, tl };
    }

    it('without focus, keeps the active project and the other project\'s active tab', () => {
      const { home, other, resident, tl } = twoProjects();
      const s = appState.addExternalSession(other.id, { name: 'w', createdBy: tl.id, focus: false })!;
      expect(appState.activeProject?.id).toBe(home.id);
      expect(other.activeSessionId).toBe(resident.id);
      expect(other.sessions.some((x) => x.id === s.id)).toBe(true);
    });

    it('with focus, switches to that project and makes the new session its active tab', () => {
      const { other, tl } = twoProjects();
      const changed = vi.fn();
      appState.on('project-changed', changed);
      const s = appState.addExternalSession(other.id, { name: 'w', createdBy: tl.id, focus: true })!;
      expect(appState.activeProject?.id).toBe(other.id);
      expect(other.activeSessionId).toBe(s.id);
      expect(changed).toHaveBeenCalled();
    });

    it('emits session-added with the target project id', () => {
      const { other, tl } = twoProjects();
      let seen: string | undefined;
      appState.on('session-added', (d) => { seen = (d as { projectId: string }).projectId; });
      appState.addExternalSession(other.id, { name: 'w', createdBy: tl.id, focus: false });
      expect(seen).toBe(other.id);
    });
  });

  describe('nav history', () => {
    function threeTabsWithBackEntry() {
      const project = appState.addProject('P', '/p')!;
      const a = appState.addSession(project.id, 'A')!;
      const b = appState.addSession(project.id, 'B')!;
      const c = appState.addSession(project.id, 'C')!;
      appState.navigateBack(); // active B, back -> A, forward -> C
      expect(project.activeSessionId).toBe(b.id);
      return { project, a, b, c };
    }

    it('leaves back/forward history and the current entry unchanged for a background open', () => {
      const { project, a, b, c } = threeTabsWithBackEntry();
      appState.addExternalSession(project.id, { name: 'w', createdBy: b.id, focus: false });
      expect(project.activeSessionId).toBe(b.id);
      appState.navigateForward();
      expect(project.activeSessionId).toBe(c.id);
      appState.navigateBack();
      appState.navigateBack();
      expect(project.activeSessionId).toBe(a.id);
    });

    it('still pushes nav history when the new session is focused', () => {
      const { project, b } = threeTabsWithBackEntry();
      const w = appState.addExternalSession(project.id, { name: 'w', createdBy: b.id, focus: true })!;
      expect(project.activeSessionId).toBe(w.id);
      appState.navigateBack();
      expect(project.activeSessionId).toBe(b.id);
    });
  });

  it('defaults externalControlEnabled to false', () => {
    expect(appState.preferences.externalControlEnabled).toBe(false);
  });
});
