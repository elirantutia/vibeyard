import { appState, type SessionRecord } from './state.js';
import { getStatus, showsBackgroundWork } from './session-activity.js';
import { showConfirmDialog } from './components/modal.js';

function projectSessions(projectId: string): SessionRecord[] {
  return appState.projects.find((p) => p.id === projectId)?.sessions ?? [];
}

function isMidTurn(sessionId: string): boolean {
  const status = getStatus(sessionId);
  return status === 'working' || status === 'input';
}

/**
 * Background work (a run_in_background shell, a monitor...) dies with the PTY,
 * so a tab showing the background ring counts as active too. Same predicate as
 * the ring, so the warning appears exactly when the user can see the marker.
 */
function isActive(sessionId: string): boolean {
  return isMidTurn(sessionId) || showsBackgroundWork(sessionId);
}

type ConfirmKind = 'close' | 'quit';

/** Dialog body, worded by how many of the active sessions are mid-turn vs. only running background work. */
function activeMessage(active: SessionRecord[], kind: ConfirmKind): string {
  const verb = kind === 'close' ? 'Closing' : 'Quitting';
  const midTurn = active.filter((s) => isMidTurn(s.id)).length;
  if (active.length === 1) {
    const name = kind === 'quit' ? 'A session' : `'${active[0].name}'`;
    return midTurn
      ? `${name} is still active. ${verb} will interrupt it.`
      : `${name} has background work that may still be running. ${verb} will stop it.`;
  }
  const n = active.length;
  if (midTurn === n) return `${n} sessions are still active. ${verb} will interrupt them.`;
  if (midTurn === 0) return `${n} sessions have background work that may still be running. ${verb} will stop it.`;
  return `${n} sessions are still active or running background work. ${verb} will stop them.`;
}

/**
 * The one confirmation gate for closing and quitting: proceed directly when the
 * preference is off or nothing collected is active, else ask first.
 */
function confirmActive(collect: () => SessionRecord[], kind: ConfirmKind, proceed: () => void): void {
  const active = appState.preferences.confirmCloseWorkingSession ? collect() : [];
  if (active.length === 0) {
    proceed();
    return;
  }
  const isSingle = active.length === 1;
  showConfirmDialog(
    kind === 'quit' ? 'Quit Vibeyard' : isSingle ? 'Close session' : 'Close sessions',
    activeMessage(active, kind),
    {
      confirmLabel: kind === 'quit' ? 'Quit' : isSingle ? 'Close' : 'Close all',
      onConfirm: proceed,
    },
  );
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
  const targets = new Set(targetIds);
  confirmActive(() => sessions.filter((s) => targets.has(s.id) && isActive(s.id)), 'close', remove);
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

export function confirmAppClose(onConfirm: () => void): void {
  confirmActive(
    () => appState.projects.flatMap((p) => p.sessions.filter((s) => isActive(s.id))),
    'quit',
    onConfirm,
  );
}
