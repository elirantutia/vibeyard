import { appState } from './state.js';
import { onChange as onStatusChange, getStatus, type SessionStatus } from './session-activity.js';

type UnreadChangeCallback = () => void;

const unreadSessions = new Set<string>();
const listeners: UnreadChangeCallback[] = [];
const prevStatus = new Map<string, SessionStatus>();

function notify(): void {
  for (const cb of listeners) cb();
}

export function init(): void {
  onStatusChange((sessionId, status) => {
    const prev = prevStatus.get(sessionId);
    prevStatus.set(sessionId, status);

    if (prev === 'working' && (status === 'waiting' || status === 'completed' || status === 'permission')) {
      // Find which project this session belongs to
      const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
      if (project && sessionId !== project.activeSessionId) {
        unreadSessions.add(sessionId);
        notify();
      }
    }
  });

  appState.on('session-changed', () => {
    const project = appState.activeProject;
    if (project && unreadSessions.has(project.activeSessionId)) {
      unreadSessions.delete(project.activeSessionId);
      notify();
    }
  });

  appState.on('session-removed', (data?: unknown) => {
    const d = data as { sessionId?: string } | undefined;
    if (d?.sessionId) {
      removeSession(d.sessionId);
    }
  });
}

export function isUnread(sessionId: string): boolean {
  return unreadSessions.has(sessionId);
}

export function hasUnreadInProject(projectId: string): boolean {
  const project = appState.projects.find(p => p.id === projectId);
  if (!project) return false;
  return project.sessions.some(s => unreadSessions.has(s.id));
}

export function removeSession(sessionId: string): void {
  if (unreadSessions.delete(sessionId)) {
    prevStatus.delete(sessionId);
    notify();
  } else {
    prevStatus.delete(sessionId);
  }
}

export function onChange(callback: UnreadChangeCallback): void {
  listeners.push(callback);
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  unreadSessions.clear();
  listeners.length = 0;
  prevStatus.clear();
}
