import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAppState = vi.hoisted(() => {
  const state = {
    activeProjectId: 'proj-1',
    projects: [
      {
        id: 'proj-1',
        name: 'Proj One',
        activeSessionId: 'active-session',
        sessions: [] as Array<{ id: string; name: string }>,
      },
    ],
    preferences: {
      notificationsDesktop: true,
    },
    get activeProject() {
      return state.projects.find(p => p.id === state.activeProjectId);
    },
    findSessionWithProject(sessionId: string) {
      for (const project of state.projects) {
        const session = project.sessions.find(s => s.id === sessionId);
        if (session) return { project, session };
      }
      return undefined;
    },
    setActiveProject: vi.fn(),
    setActiveSession: vi.fn(),
    // Capture registered appState listeners so tests can fire them.
    listeners: new Map<string, (data: unknown) => void>(),
    on: vi.fn((event: string, cb: (data: unknown) => void) => {
      state.listeners.set(event, cb);
    }),
  };
  return state;
});

vi.mock('./state.js', () => ({
  appState: mockAppState,
}));

import { _resetForTesting as resetActivity, setHookStatus, initSession } from './session-activity.js';
import { _resetForTesting as resetDesktopNotif, initNotificationDesktop } from './notification-desktop.js';


// Track Notification constructor calls
let notificationInstances: MockNotification[] = [];
// Interleaved log of construction/close events, so tests can assert ordering.
let notificationEvents: string[] = [];
let mockHasFocus = false;

class MockNotification {
  static permission = 'granted';
  static requestPermission = vi.fn().mockResolvedValue('granted');
  title: string;
  options: NotificationOptions;
  index: number;
  closed = false;
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(title: string, options: NotificationOptions = {}) {
    this.title = title;
    this.options = options;
    this.index = notificationInstances.length;
    notificationInstances.push(this);
    notificationEvents.push(`create:${this.index}`);
  }
  close(): void {
    this.closed = true;
    notificationEvents.push(`close:${this.index}`);
    this.onclose?.();
  }
}

// Set up globals before imports use them
Object.defineProperty(globalThis, 'Notification', { value: MockNotification, writable: true, configurable: true });
if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = { hasFocus: () => mockHasFocus };
} else {
  vi.spyOn(document, 'hasFocus').mockImplementation(() => mockHasFocus);
}
const focusSpy = vi.fn();
(globalThis as any).window = { vibeyard: { app: { focus: focusSpy } } };

describe('notification-desktop', () => {
  beforeEach(() => {
    resetActivity();
    resetDesktopNotif();
    notificationInstances = [];
    notificationEvents = [];
    mockHasFocus = false;
    mockAppState.preferences.notificationsDesktop = true;
    mockAppState.activeProjectId = 'proj-1';
    mockAppState.projects[0].activeSessionId = 'active-session';
    mockAppState.projects[0].sessions = [
      { id: 'active-session', name: 'Active Session' },
      { id: 'bg-session', name: 'Background Session' },
    ];
    mockAppState.setActiveProject.mockClear();
    mockAppState.setActiveSession.mockClear();
    MockNotification.permission = 'granted';
    initNotificationDesktop();
  });

  it('should notify on working → waiting for background session', () => {
    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances).toHaveLength(1);
    // Title is the owning project, so same-named sessions in different projects
    // are distinguishable in the banner.
    expect(notificationInstances[0].title).toBe('Proj One');
    expect(notificationInstances[0].options.body).toBe('Background Session is waiting for input');
    expect(notificationInstances[0].options.silent).toBe(true);
  });

  it('should notify on working → completed', () => {
    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'completed');

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].options.body).toBe('Background Session has completed');
  });

  it('should notify on working → input', () => {
    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'input');

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].options.body).toBe('Background Session needs your input to continue');
  });

  it('should not notify when preference is disabled', () => {
    mockAppState.preferences.notificationsDesktop = false;

    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances).toHaveLength(0);
  });

  it('should not notify for active session when app is focused', () => {
    mockHasFocus = true;

    initSession('active-session');
    setHookStatus('active-session', 'working');
    setHookStatus('active-session', 'waiting');

    expect(notificationInstances).toHaveLength(0);
  });

  it('should notify for active session when app is NOT focused', () => {
    mockHasFocus = false;

    initSession('active-session');
    setHookStatus('active-session', 'working');
    setHookStatus('active-session', 'waiting');

    expect(notificationInstances).toHaveLength(1);
  });

  it('should notify for background session even when app is focused', () => {
    mockHasFocus = true;

    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances).toHaveLength(1);
  });

  it('should not notify on non-working → waiting transition', () => {
    initSession('bg-session');
    // Session starts as 'waiting' — previous status in notification module is undefined
    setHookStatus('bg-session', 'completed');
    expect(notificationInstances).toHaveLength(0);
  });

  it('should focus app and switch session on notification click', () => {
    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances).toHaveLength(1);
    focusSpy.mockClear();
    notificationInstances[0].onclick!();

    expect(focusSpy).toHaveBeenCalled();
    expect(mockAppState.setActiveProject).toHaveBeenCalledWith('proj-1');
    expect(mockAppState.setActiveSession).toHaveBeenCalledWith('proj-1', 'bg-session');
  });

  it('should not set a tag, which would destroy the previous notification\'s click listener', () => {
    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances[0].options.tag).toBeUndefined();
  });

  it('should close the previous banner before posting a new one for the same session', () => {
    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'completed');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'completed');

    expect(notificationInstances).toHaveLength(2);
    // The stale banner is dismissed before the replacement is constructed, so
    // the user is never left with an inert notification to click.
    expect(notificationEvents).toEqual(['create:0', 'close:0', 'create:1']);

    notificationInstances[1].onclick!();
    expect(mockAppState.setActiveSession).toHaveBeenLastCalledWith('proj-1', 'bg-session');
  });

  it('should route clicks to the correct session id when two sessions share a name', () => {
    // Two distinct sessions that happen to share the same display name.
    mockAppState.projects[0].sessions.push(
      { id: 'dup-a', name: 'Session 6' } as any,
      { id: 'dup-b', name: 'Session 6' } as any,
    );

    initSession('dup-a');
    setHookStatus('dup-a', 'working');
    setHookStatus('dup-a', 'completed');

    initSession('dup-b');
    setHookStatus('dup-b', 'working');
    setHookStatus('dup-b', 'completed');

    expect(notificationInstances).toHaveLength(2);
    // Identical text, but each notification keeps its own live click listener.
    expect(notificationInstances[0].options.body).toBe('Session 6 has completed');
    expect(notificationInstances[1].options.body).toBe('Session 6 has completed');
    // Neither banner is closed by the other — different sessions, different entries.
    expect(notificationInstances.some(n => n.closed)).toBe(false);

    // Clicking each notification focuses the id that produced it, not the other same-named session.
    notificationInstances[0].onclick!();
    expect(mockAppState.setActiveSession).toHaveBeenLastCalledWith('proj-1', 'dup-a');

    notificationInstances[1].onclick!();
    expect(mockAppState.setActiveSession).toHaveBeenLastCalledWith('proj-1', 'dup-b');
  });

  it('should dismiss a live banner when its session is removed', () => {
    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'completed');

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].closed).toBe(false);

    mockAppState.listeners.get('session-removed')!({ sessionId: 'bg-session' });

    expect(notificationInstances[0].closed).toBe(true);
  });

  it('should not notify when Notification permission is not granted', () => {
    MockNotification.permission = 'denied';

    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances).toHaveLength(0);
  });

  it('should fall back to "Vibeyard" / "Session" for an unknown session', () => {
    initSession('unknown-session');
    setHookStatus('unknown-session', 'working');
    setHookStatus('unknown-session', 'waiting');

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].title).toBe('Vibeyard');
    expect(notificationInstances[0].options.body).toBe('Session is waiting for input');
  });
});
