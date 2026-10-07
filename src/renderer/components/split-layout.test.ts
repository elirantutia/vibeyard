import { beforeEach, describe, expect, it, vi } from 'vitest';

// split-layout.ts grabs #terminal-container at module load and wires a wide
// graph of pane modules. Every pane module is mocked; only the session-added
// path (onSessionAdded) is exercised, through the handler initSplitLayout
// registers on appState.

const handlers: Record<string, (data?: unknown) => void> = {};
const fakeState = {
  projects: [] as Array<Record<string, unknown>>,
  activeProject: undefined as Record<string, unknown> | undefined,
  profiles: [] as Array<{ id: string; providerId: string; configDir: string }>,
  on: vi.fn((event: string, cb: (data?: unknown) => void) => { handlers[event] = cb; }),
  setActiveSession: vi.fn(),
  consumePendingInitialPrompt: vi.fn(),
  consumePendingSystemPrompt: vi.fn(),
};
vi.mock('../state.js', () => ({ appState: fakeState }));
vi.mock('../session-unread.js', () => ({ isUnread: vi.fn(() => false), onChange: vi.fn() }));

const terminal = {
  createTerminalPane: vi.fn(),
  attachToContainer: vi.fn(),
  showPane: vi.fn(),
  hideAllPanes: vi.fn(),
  fitAllVisible: vi.fn(),
  setFocused: vi.fn(),
  spawnTerminal: vi.fn(),
  setPendingPrompt: vi.fn(),
  setPendingSystemPrompt: vi.fn(),
  destroyTerminal: vi.fn(),
  getTerminalInstance: vi.fn(),
};
vi.mock('./terminal-pane.js', () => terminal);
vi.mock('./mcp-inspector.js', () => ({
  createInspectorPane: vi.fn(), destroyInspectorPane: vi.fn(), showInspectorPane: vi.fn(),
  hideAllInspectorPanes: vi.fn(), attachInspectorToContainer: vi.fn(), getInspectorInstance: vi.fn(),
  disconnectInspector: vi.fn(),
}));
vi.mock('./session-inspector.js', () => ({ isInspectorOpen: vi.fn(() => false) }));
vi.mock('./file-viewer.js', () => ({
  createFileViewerPane: vi.fn(), destroyFileViewerPane: vi.fn(), showFileViewerPane: vi.fn(),
  hideAllFileViewerPanes: vi.fn(), attachFileViewerToContainer: vi.fn(), getFileViewerInstance: vi.fn(),
}));
vi.mock('./file-reader.js', () => ({
  createFileReaderPane: vi.fn(), destroyFileReaderPane: vi.fn(), showFileReaderPane: vi.fn(),
  hideAllFileReaderPanes: vi.fn(), attachFileReaderToContainer: vi.fn(), getFileReaderInstance: vi.fn(),
  setFileReaderLine: vi.fn(),
}));
vi.mock('./remote-terminal-pane.js', () => ({
  getRemoteTerminalInstance: vi.fn(), destroyRemoteTerminal: vi.fn(), attachRemoteToContainer: vi.fn(),
  showRemotePane: vi.fn(), hideAllRemotePanes: vi.fn(),
}));
vi.mock('./browser-tab-pane.js', () => ({
  createBrowserTabPane: vi.fn(), destroyBrowserTabPane: vi.fn(), showBrowserTabPane: vi.fn(),
  hideAllBrowserTabPanes: vi.fn(), attachBrowserTabToContainer: vi.fn(), getBrowserTabInstance: vi.fn(),
}));
vi.mock('./project-tab/pane.js', () => ({
  createProjectTabPane: vi.fn(), destroyProjectTabPane: vi.fn(), showProjectTabPane: vi.fn(),
  hideAllProjectTabPanes: vi.fn(), attachProjectTabToContainer: vi.fn(), getProjectTabInstance: vi.fn(),
}));
vi.mock('./kanban/pane.js', () => ({
  createKanbanPane: vi.fn(), destroyKanbanPane: vi.fn(), showKanbanPane: vi.fn(),
  hideAllKanbanPanes: vi.fn(), attachKanbanToContainer: vi.fn(), getKanbanInstance: vi.fn(),
}));
vi.mock('./team/pane.js', () => ({
  createTeamPane: vi.fn(), destroyTeamPane: vi.fn(), showTeamPane: vi.fn(),
  hideAllTeamPanes: vi.fn(), attachTeamToContainer: vi.fn(), getTeamInstance: vi.fn(),
}));
vi.mock('./tab-bar.js', () => ({ quickNewSession: vi.fn() }));

class FakeElement {
  className = '';
  style: Record<string, string> = {};
  children: FakeElement[] = [];
  classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  appendChild(c: FakeElement) { this.children.push(c); return c; }
  append() {}
  addEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  remove() {}
}
const rafQueue: Array<() => void> = [];
vi.stubGlobal('document', {
  getElementById: () => new FakeElement(),
  createElement: () => new FakeElement(),
  querySelector: () => null,
  activeElement: null,
  body: {},
});
vi.stubGlobal('window', { addEventListener: vi.fn() });
vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { rafQueue.push(cb); return rafQueue.length; });

const { initSplitLayout } = await import('./split-layout.js');
initSplitLayout();

function flushRaf(): void {
  while (rafQueue.length) rafQueue.shift()!();
}

function project(id: string, path: string) {
  return {
    id, name: id, path,
    sessions: [] as Array<Record<string, unknown>>,
    activeSessionId: null as string | null,
    layout: { mode: 'tabs', splitPanes: [] as string[], splitDirection: 'horizontal' },
  };
}

describe('onSessionAdded', () => {
  let active: ReturnType<typeof project>;
  let other: ReturnType<typeof project>;

  beforeEach(() => {
    vi.clearAllMocks();
    rafQueue.length = 0;
    active = project('p-active', '/work/active');
    other = project('p-other', '/work/other');
    fakeState.projects = [active, other];
    fakeState.activeProject = active;
    fakeState.consumePendingInitialPrompt.mockImplementation((pid: string, sid: string) =>
      pid === other.id && sid === 'w1' ? 'do the task' : undefined);
  });

  it('creates a CLI pane for a non-active project with that project\'s cwd and id, and hands it the prompt', () => {
    const session = { id: 'w1', cliSessionId: null, providerId: 'claude' };
    other.sessions.push(session);

    handlers['session-added']({ projectId: other.id, session });

    expect(terminal.createTerminalPane).toHaveBeenCalledTimes(1);
    const args = terminal.createTerminalPane.mock.calls[0];
    expect(args[0]).toBe('w1');
    expect(args[1]).toBe('/work/other');
    expect(args[6]).toBe('p-other');
    expect(fakeState.consumePendingInitialPrompt).toHaveBeenCalledWith('p-other', 'w1');
    expect(fakeState.consumePendingSystemPrompt).toHaveBeenCalledWith('p-other', 'w1');
    expect(terminal.setPendingPrompt).toHaveBeenCalledWith('w1', 'do the task');
  });

  it('spawns the non-active project\'s pane without re-laying out the active project', () => {
    const session = { id: 'w1', cliSessionId: null, providerId: 'claude' };
    other.sessions.push(session);

    handlers['session-added']({ projectId: other.id, session });
    flushRaf();

    expect(terminal.spawnTerminal).toHaveBeenCalledWith('w1');
    expect(terminal.hideAllPanes).not.toHaveBeenCalled();
    expect(terminal.fitAllVisible).not.toHaveBeenCalled();
  });

  it('keeps the existing behaviour for a session added to the active project', () => {
    fakeState.consumePendingInitialPrompt.mockImplementation((pid: string, sid: string) =>
      pid === active.id && sid === 's1' ? 'hi' : undefined);
    const session = { id: 's1', cliSessionId: null, providerId: 'claude' };
    active.sessions.push(session);
    active.activeSessionId = 's1';

    handlers['session-added']({ projectId: active.id, session });
    flushRaf();

    const args = terminal.createTerminalPane.mock.calls[0];
    expect(args[1]).toBe('/work/active');
    expect(args[6]).toBe('p-active');
    expect(terminal.setPendingPrompt).toHaveBeenCalledWith('s1', 'hi');
    expect(terminal.hideAllPanes).toHaveBeenCalled(); // renderLayout ran
    expect(terminal.spawnTerminal).toHaveBeenCalledWith('s1');
    expect(terminal.fitAllVisible).toHaveBeenCalled();
  });

  it('ignores a session for a project that no longer exists', () => {
    const session = { id: 'gone', cliSessionId: null };
    handlers['session-added']({ projectId: 'p-missing', session });
    flushRaf();
    expect(terminal.createTerminalPane).not.toHaveBeenCalled();
    expect(terminal.spawnTerminal).not.toHaveBeenCalled();
  });
});
