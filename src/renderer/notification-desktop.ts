import { appState } from './state.js';
import { onChange, type SessionStatus } from './session-activity.js';

const previousStatus = new Map<string, SessionStatus>();

function getSessionName(sessionId: string): string {
  for (const project of appState.projects) {
    const session = project.sessions.find(s => s.id === sessionId);
    if (session) return session.name;
  }
  return 'Session';
}

function bodyForStatus(name: string, status: SessionStatus): string {
  if (status === 'permission') return `${name} needs permission to continue`;
  if (status === 'completed') return `${name} has completed`;
  return `${name} is waiting for input`;
}

function showNotification(sessionId: string, status: SessionStatus): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const name = getSessionName(sessionId);
  const notification = new Notification('Vibeyard', {
    body: bodyForStatus(name, status),
    silent: true,
  });

  notification.onclick = () => {
    window.focus();
    const project = appState.projects.find(p =>
      p.sessions.some(s => s.id === sessionId),
    );
    if (project) {
      appState.setActiveProject(project.id);
      appState.setActiveSession(sessionId);
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
    if (status !== 'waiting' && status !== 'completed' && status !== 'permission') return;
    if (document.hasFocus() && sessionId === appState.activeProject?.activeSessionId) return;

    showNotification(sessionId, status);
  });

  appState.on('session-removed', (data) => {
    const sessionId = (data as { sessionId: string })?.sessionId;
    if (sessionId) previousStatus.delete(sessionId);
  });
}

export function _resetForTesting(): void {
  previousStatus.clear();
}
