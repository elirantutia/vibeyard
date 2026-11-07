import { appState, type SessionRecord } from './state.js';
import { getStatus } from './session-activity.js';
import { showConfirmDialog } from './components/modal.js';
import { collectRemovalIds, type RemovalMode } from './state/layout-state.js';

function projectSessions(projectId: string): SessionRecord[] {
  return appState.projects.find((p) => p.id === projectId)?.sessions ?? [];
}

function isActive(sessionId: string): boolean {
  const status = getStatus(sessionId);
  return status === 'working' || status === 'input';
}

/** True when closing this session would show the "still active" dialog. */
export function needsCloseConfirmation(sessionId: string): boolean {
  return appState.preferences.confirmCloseWorkingSession && isActive(sessionId);
}

function confirmAndClose(
  sessions: SessionRecord[],
  targetIds: string[],
  remove: () => void,
): void {
  if (!appState.preferences.confirmCloseWorkingSession) {
    remove();
    return;
  }
  const targets = new Set(targetIds);
  const active = sessions.filter((s) => targets.has(s.id) && isActive(s.id));
  if (active.length === 0) {
    remove();
    return;
  }
  const isSingle = active.length === 1;
  showConfirmDialog(
    isSingle ? 'Close session' : 'Close sessions',
    isSingle
      ? `'${active[0].name}' is still active. Closing will interrupt it.`
      : `${active.length} sessions are still active. Closing will interrupt them.`,
    {
      confirmLabel: isSingle ? 'Close' : 'Close all',
      onConfirm: remove,
    },
  );
}

export function closeSessionWithConfirm(projectId: string, sessionId: string): void {
  confirmAndClose(
    projectSessions(projectId),
    [sessionId],
    () => appState.removeSession(projectId, sessionId),
  );
}

export function closeSessionById(sessionId: string): void {
  const project = appState.projects.find((p) =>
    p.sessions.some((s) => s.id === sessionId),
  );
  if (project) appState.removeSession(project.id, sessionId);
}

export async function closeSessionIfFileMissing(sessionId: string, fullPath: string): Promise<boolean> {
  if (await window.vibeyard.fs.exists(fullPath)) return false;
  closeSessionById(sessionId);
  return true;
}

// --- Tab close (tab bar, keyboard shortcut) ---
//
// Closing a *tab* never ends a live CLI session: the session is detached (PTY
// kept, listed in the sidebar Active Sessions panel, where the full close lives).
// Non-CLI tabs (files, browser, kanban, ...) hold no process and are removed.
// A CLI whose process exits is already removed by the pty.onExit handler.
// Ending a session for good goes through closeSessionWithConfirm (Active
// Sessions panel, vibeyard-ctl).

/** Close one tab: detach a CLI session, remove anything else. */
export function closeTab(projectId: string, sessionId: string): void {
  appState.closeTabs(projectId, [sessionId]);
}

/** Close a group of tabs relative to an anchor (tab context menu), same rules as closeTab. */
export function closeTabsByMode(projectId: string, mode: RemovalMode, anchorSessionId?: string): void {
  const project = appState.projects.find((p) => p.id === projectId);
  if (!project) return;
  appState.closeTabs(projectId, collectRemovalIds(project, mode, anchorSessionId));
}

function countActiveSessions(): number {
  let count = 0;
  for (const project of appState.projects) {
    for (const session of project.sessions) {
      if (isActive(session.id)) count++;
    }
  }
  return count;
}

export function confirmAppClose(onConfirm: () => void): void {
  if (!appState.preferences.confirmCloseWorkingSession) {
    onConfirm();
    return;
  }
  const count = countActiveSessions();
  if (count === 0) {
    onConfirm();
    return;
  }
  const isSingle = count === 1;
  showConfirmDialog(
    'Quit Vibeyard',
    isSingle
      ? 'A session is still active. Quitting will interrupt it.'
      : `${count} sessions are still active. Quitting will interrupt them.`,
    {
      confirmLabel: 'Quit',
      onConfirm,
    },
  );
}
