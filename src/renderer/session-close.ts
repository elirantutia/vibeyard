import { appState, type SessionRecord } from './state.js';
import { getStatus } from './session-activity.js';
import { showConfirmDialog } from './components/modal.js';

function projectSessions(projectId: string): SessionRecord[] {
  return appState.projects.find((p) => p.id === projectId)?.sessions ?? [];
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
  const working = sessions.filter((s) => targets.has(s.id) && getStatus(s.id) === 'working');
  if (working.length === 0) {
    remove();
    return;
  }
  const isSingle = working.length === 1;
  showConfirmDialog(
    isSingle ? 'Close session' : 'Close sessions',
    isSingle
      ? `'${working[0].name}' is still working. Closing will interrupt the running task.`
      : `${working.length} sessions are still working. Closing will interrupt running tasks.`,
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

export function closeAllSessionsWithConfirm(projectId: string): void {
  const sessions = projectSessions(projectId);
  confirmAndClose(
    sessions,
    sessions.map((s) => s.id),
    () => appState.removeAllSessions(projectId),
  );
}

export function closeOtherSessionsWithConfirm(projectId: string, sessionId: string): void {
  const sessions = projectSessions(projectId);
  confirmAndClose(
    sessions,
    sessions.filter((s) => s.id !== sessionId).map((s) => s.id),
    () => appState.removeOtherSessions(projectId, sessionId),
  );
}

export function closeSessionsFromRightWithConfirm(projectId: string, sessionId: string): void {
  const sessions = projectSessions(projectId);
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  confirmAndClose(
    sessions,
    sessions.slice(idx + 1).map((s) => s.id),
    () => appState.removeSessionsFromRight(projectId, sessionId),
  );
}

export function closeSessionsFromLeftWithConfirm(projectId: string, sessionId: string): void {
  const sessions = projectSessions(projectId);
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return;
  confirmAndClose(
    sessions,
    sessions.slice(0, idx).map((s) => s.id),
    () => appState.removeSessionsFromLeft(projectId, sessionId),
  );
}
