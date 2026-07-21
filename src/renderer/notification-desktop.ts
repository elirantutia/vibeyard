import { appState } from './state.js';
import { onChange, type SessionStatus } from './session-activity.js';

const previousStatus = new Map<string, SessionStatus>();

// Retain live notifications so their onclick closures aren't garbage-collected
// before the user clicks, and so a stale notification can be closed/replaced.
const activeNotifications = new Map<string, Notification>();

function getSessionName(sessionId: string): string {
  for (const project of appState.projects) {
    const session = project.sessions.find(s => s.id === sessionId);
    if (session) return session.name;
  }
  return 'Session';
}

function bodyForStatus(name: string, status: SessionStatus): string {
  if (status === 'input') return `${name} needs your input to continue`;
  if (status === 'completed') return `${name} has completed`;
  return `${name} is waiting for input`;
}

function showNotification(sessionId: string, status: SessionStatus): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const name = getSessionName(sessionId);
  const notification = new Notification('Vibeyard', {
    body: bodyForStatus(name, status),
    // A per-session tag keeps notifications for different sessions distinct at
    // the OS level (so same-named sessions don't coalesce and misroute clicks),
    // while a newer notification for the same session replaces its own stale one.
    tag: `vibeyard-session-${sessionId}`,
    silent: true,
  });
  activeNotifications.set(sessionId, notification);

  notification.onclick = () => {
    window.vibeyard.app.focus();
    const project = appState.projects.find(p =>
      p.sessions.some(s => s.id === sessionId),
    );
    if (project) {
      appState.setActiveProject(project.id);
      appState.setActiveSession(project.id, sessionId);
    }
    notification.close();
    activeNotifications.delete(sessionId);
  };

  notification.onclose = () => {
    // Only drop the entry if it still points at this instance — a replacement
    // notification for the same session must not be clobbered.
    if (activeNotifications.get(sessionId) === notification) {
      activeNotifications.delete(sessionId);
    }
  };
}

export function initNotificationDesktop(): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  onChange((sessionId: string, status: SessionStatus) => {
    const prev = previousStatus.get(sessionId);
    previousStatus.set(sessionId, status);

    if (!appState.preferences.notificationsDesktop) return;
    if (prev !== 'working') return;
    if (status !== 'waiting' && status !== 'completed' && status !== 'input') return;
    if (document.hasFocus() && sessionId === appState.activeProject?.activeSessionId) return;

    showNotification(sessionId, status);
  });

  appState.on('session-removed', (data) => {
    const sessionId = (data as { sessionId: string })?.sessionId;
    if (sessionId) {
      previousStatus.delete(sessionId);
      activeNotifications.get(sessionId)?.close();
      activeNotifications.delete(sessionId);
    }
  });
}

export function _resetForTesting(): void {
  previousStatus.clear();
  activeNotifications.clear();
}
