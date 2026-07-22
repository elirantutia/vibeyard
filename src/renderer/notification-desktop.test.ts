import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockAppState = vi.hoisted(() => {
  const state = {
    activeProjectId: 'proj-1',
    projects: [
      {
        id: 'proj-1',
        activeSessionId: 'active-session',
        sessions: [
          { id: 'active-session', name: 'Active Session' },
          { id: 'bg-session', name: 'Background Session' },
        ],
      },
    ],
    preferences: {
      notificationsDesktop: true,
    },
    get activeProject() {
      return state.projects.find(p => p.id === state.activeProjectId);
    },
    setActiveProject: vi.fn(),
    setActiveSession: vi.fn(),
    on: vi.fn(),
  };
  return state;
});

vi.mock('./state.js', () => ({
  appState: mockAppState,
}));

import { _resetForTesting as resetActivity, setHookStatus, initSession } from './session-activity.js';
import { _resetForTesting as resetDesktopNotif, initNotificationDesktop } from './notification-desktop.js';


// Track Notification constructor calls
let notificationInstances: Array<{ title: string; options: NotificationOptions; onclick: (() => void) | null }> = [];
let mockHasFocus = false;

class MockNotification {
  static permission = 'granted';
  static requestPermission = vi.fn().mockResolvedValue('granted');
  title: string;
  options: NotificationOptions;
  onclick: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(title: string, options: NotificationOptions = {}) {
    this.title = title;
    this.options = options;
    notificationInstances.push(this as any);
  }
  close(): void {
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

describe('notification-desktop', () => {
  beforeEach(() => {
    resetActivity();
    resetDesktopNotif();
    notificationInstances = [];
    mockHasFocus = false;
    mockAppState.preferences.notificationsDesktop = true;
    mockAppState.activeProjectId = 'proj-1';
    mockAppState.projects[0].activeSessionId = 'active-session';
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
    expect(notificationInstances[0].title).toBe('Vibeyard');
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
    const focusSpy = vi.fn();
    (globalThis as any).window = {
      focus: focusSpy,
      vibeyard: { app: { focus: focusSpy } },
    };

    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].options.tag).toBe('vibeyard-session-bg-session');
    notificationInstances[0].onclick!();

    expect(mockAppState.setActiveProject).toHaveBeenCalledWith('proj-1');
    expect(mockAppState.setActiveSession).toHaveBeenCalledWith('proj-1', 'bg-session');
  });

  it('should route clicks to the correct session id when two sessions share a name', () => {
    const focusSpy = vi.fn();
    (globalThis as any).window = {
      focus: focusSpy,
      vibeyard: { app: { focus: focusSpy } },
    };

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
    // Identical body, but distinct per-session tags keep them separate at the OS level.
    expect(notificationInstances[0].options.body).toBe('Session 6 has completed');
    expect(notificationInstances[1].options.body).toBe('Session 6 has completed');
    expect(notificationInstances[0].options.tag).toBe('vibeyard-session-dup-a');
    expect(notificationInstances[1].options.tag).toBe('vibeyard-session-dup-b');
    expect(notificationInstances[0].options.tag).not.toBe(notificationInstances[1].options.tag);

    // Clicking each notification focuses the id that produced it, not the other same-named session.
    notificationInstances[0].onclick!();
    expect(mockAppState.setActiveSession).toHaveBeenLastCalledWith('proj-1', 'dup-a');

    notificationInstances[1].onclick!();
    expect(mockAppState.setActiveSession).toHaveBeenLastCalledWith('proj-1', 'dup-b');
  });

  it('should not notify when Notification permission is not granted', () => {
    MockNotification.permission = 'denied';

    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances).toHaveLength(0);
  });

  it('should fall back to "Session" name for unknown session', () => {
    initSession('unknown-session');
    setHookStatus('unknown-session', 'working');
    setHookStatus('unknown-session', 'waiting');

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].options.body).toBe('Session is waiting for input');
  });
});
