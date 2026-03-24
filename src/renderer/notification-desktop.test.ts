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
  constructor(title: string, options: NotificationOptions = {}) {
    this.title = title;
    this.options = options;
    notificationInstances.push(this as any);
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

  it('should notify on working → permission', () => {
    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'permission');

    expect(notificationInstances).toHaveLength(1);
    expect(notificationInstances[0].options.body).toBe('Background Session needs permission to continue');
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
    (globalThis as any).window = { focus: focusSpy };
    // Also ensure the module's window.focus works
    vi.stubGlobal('focus', focusSpy);

    initSession('bg-session');
    setHookStatus('bg-session', 'working');
    setHookStatus('bg-session', 'waiting');

    expect(notificationInstances).toHaveLength(1);
    notificationInstances[0].onclick!();

    expect(mockAppState.setActiveProject).toHaveBeenCalledWith('proj-1');
    expect(mockAppState.setActiveSession).toHaveBeenCalledWith('bg-session');
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
