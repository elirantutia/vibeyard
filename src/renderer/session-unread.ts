import { appState } from './state.js';
import { onChange as onStatusChange, type SessionStatus } from './session-activity.js';

type UnreadChangeCallback = () => void;

const unreadSessions = new Set<string>();
const listeners: UnreadChangeCallback[] = [];
const prevStatus = new Map<string, SessionStatus>();
let readPending = false;

function notify(): void {
  for (const cb of listeners) cb();
}

/**
 * The focused session has been seen — drop it from the unread set.
 *
 * Deferred by a microtask because switching projects is a *sequence*, not one
 * event: callers do `setActiveProject` then activate a session (e.g. the Active
 * Sessions panel). Reading `activeSessionId` the instant `project-changed` fires
 * would see the target project's PREVIOUS session and clear an unread badge the
 * user never saw; one microtask later the sequence has settled. It must be a
 * microtask and not rAF — the sidebar renders synchronously on `project-changed`,
 * so deferring past paint would show the accent colour and then remove it.
 * The latch keeps a burst (`stepNav` emits both events) to one scheduled pass.
 */
function markActiveSessionRead(): void {
  if (readPending) return;
  readPending = true;
  queueMicrotask(() => {
    readPending = false;
    const sessionId = appState.activeProject?.activeSessionId;
    if (!sessionId) return;
    if (unreadSessions.delete(sessionId)) notify();
  });
}

export function init(): void {
  onStatusChange((sessionId, status) => {
    const prev = prevStatus.get(sessionId);
    prevStatus.set(sessionId, status);

    if (prev === 'working' && (status === 'waiting' || status === 'completed' || status === 'input')) {
      // Find which project this session belongs to
      const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
      // "Focused", not "visible": a dimmed swarm pane is on screen but still counts
      // as unread — split-layout renders `swarm-unread` on exactly those panes.
      const isFocusedSession =
        project?.id === appState.activeProjectId && sessionId === project?.activeSessionId;
      if (project && !isFocusedSession) {
        unreadSessions.add(sessionId);
        notify();
      }
    }
  });

  // `session-changed` covers tab clicks and Cmd+1..9. `project-changed` is just as
  // load-bearing: clicking a project in the sidebar brings that project's active
  // session on screen without ever touching activeSessionId, so it emits no
  // `session-changed` — and the session it reveals renders no unread tab dot
  // (tab-list masks the active tab), leaving the sidebar project name accent-coloured
  // with no click left that could clear it.
  appState.on('session-changed', markActiveSessionRead);
  appState.on('project-changed', markActiveSessionRead);

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

export function onChange(callback: UnreadChangeCallback): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  unreadSessions.clear();
  listeners.length = 0;
  prevStatus.clear();
  readPending = false;
}
