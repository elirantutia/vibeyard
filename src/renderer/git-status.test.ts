import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();
const mockWatchProject = vi.fn();
const mockGetStatus = vi.fn();
const mockGetWorktrees = vi.fn();
const mockOnChanged = vi.fn(() => () => {});

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: mockLoad, save: mockSave },
    git: {
      watchProject: mockWatchProject,
      getStatus: mockGetStatus,
      getWorktrees: mockGetWorktrees,
      onChanged: mockOnChanged,
    },
  },
});

// git-status's startPolling reads document.hidden and registers a
// visibilitychange listener; provide a minimal stub for the node env.
vi.stubGlobal('document', {
  hidden: false,
  addEventListener: vi.fn(),
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

// Avoid pulling in the full session-activity dependency graph; git-status only
// needs its onChange export to register a status-transition listener.
vi.mock('./session-activity.js', () => ({
  onChange: vi.fn(),
}));

import { appState, _resetForTesting as resetState } from './state';
import { startPolling, stopPolling, _resetForTesting as resetGit } from './git-status';

const layout = { mode: 'tabs' as const, splitPanes: [], splitDirection: 'horizontal' as const };

function project(id: string, path: string) {
  return { id, name: id, path, sessions: [], activeSessionId: null, layout };
}

function persisted(projects: ReturnType<typeof project>[], activeProjectId: string | null) {
  return {
    version: 1,
    projects,
    activeProjectId,
    preferences: { soundOnSessionWaiting: true, debugMode: false },
  };
}

const cleanStatus = {
  isGitRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  staged: 1,
  modified: 2,
  untracked: 0,
  conflicted: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  mockGetStatus.mockResolvedValue(cleanStatus);
  mockGetWorktrees.mockResolvedValue([]);
  resetState();
  resetGit();
});

afterEach(() => {
  stopPolling();
});

describe('git-status state-loaded handling', () => {
  it('watches the project and polls on initial load with an active project but no session', async () => {
    // Cold start: polling begins before state is loaded, so there is no active
    // project yet — nothing should be watched or polled at this point.
    mockLoad.mockResolvedValue(persisted([project('p1', '/proj')], 'p1'));
    startPolling();
    expect(mockWatchProject).not.toHaveBeenCalled();
    expect(mockGetStatus).not.toHaveBeenCalled();

    // Loading persisted state emits only 'state-loaded' (not 'project-changed'),
    // which previously left the git panel without any status. The new handler
    // must kick off a watch + poll so a bare project shows its git changes.
    await appState.load();
    await vi.waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith('/proj'));

    expect(mockWatchProject).toHaveBeenCalledWith('/proj');
  });

  it('polls the newly active project on switch even though the poll timer is already running', async () => {
    // Load with two projects, p1 active — this starts the 60s poll timer.
    mockLoad.mockResolvedValue(persisted([project('p1', '/proj'), project('p2', '/proj2')], 'p1'));
    startPolling();
    await appState.load();
    await vi.waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith('/proj'));
    // Let p1's poll fully settle so no poll is in flight at switch time.
    await vi.waitFor(() => expect(mockGetStatus).toHaveResolved());

    mockWatchProject.mockClear();
    mockGetStatus.mockClear();

    // Switch to p2. The timer is already running, so startInterval() no-ops —
    // the immediate refresh must come from the explicit poll().
    appState.setActiveProject('p2');

    await vi.waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith('/proj2'));
    expect(mockWatchProject).toHaveBeenCalledWith('/proj2');
  });

  it('re-polls the newly active project when a poll was still in flight during the switch', async () => {
    // First getStatus hangs, so a poll stays in flight across the switch. With
    // a plain `if (polling) return` guard the switch poll would be dropped and
    // p2 never fetched until the 60s tick; coalescing must re-poll for p2.
    let releaseFirst!: (v: typeof cleanStatus) => void;
    const firstStatus = new Promise<typeof cleanStatus>((r) => { releaseFirst = r; });
    mockGetStatus.mockReturnValueOnce(firstStatus).mockResolvedValue(cleanStatus);

    mockLoad.mockResolvedValue(persisted([project('p1', '/proj'), project('p2', '/proj2')], 'p1'));
    startPolling();
    await appState.load();
    // p1's poll is now in flight, parked on the hanging getStatus('/proj').
    await vi.waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith('/proj'));

    // Switch while the poll is in flight — must be coalesced, not dropped.
    appState.setActiveProject('p2');

    // Release p1's poll; the coalesced re-poll should then fetch p2.
    releaseFirst(cleanStatus);

    await vi.waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith('/proj2'));
  });

  it('does not watch or poll on load when there is no active project', async () => {
    mockLoad.mockResolvedValue(null); // keeps state empty → no active project
    startPolling();

    await appState.load();
    // Give any stray async work a chance to run.
    await Promise.resolve();

    expect(mockWatchProject).not.toHaveBeenCalled();
    expect(mockGetStatus).not.toHaveBeenCalled();
  });
});
