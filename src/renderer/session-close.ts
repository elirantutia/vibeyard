import { appState, type SessionRecord } from './state.js';
import { getStatus } from './session-activity.js';
import { showConfirmDialog } from './components/modal.js';

function projectSessions(projectId: string): SessionRecord[] {
  return appState.projects.find((p) => p.id === projectId)?.sessions ?? [];
}

function isActive(sessionId: string): boolean {
  const status = getStatus(sessionId);
  return status === 'working' || status === 'input';
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
