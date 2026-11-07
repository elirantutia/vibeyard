import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: mockLoad, save: mockSave },
  },
});

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

vi.mock('./session-cost.js', () => ({
  getCost: vi.fn().mockReturnValue(null),
  restoreCost: vi.fn(),
}));

vi.mock('./session-context.js', () => ({
  restoreContext: vi.fn(),
}));

const { mockShowConfirmDialog, mockGetStatus } = vi.hoisted(() => ({
  mockShowConfirmDialog: vi.fn(),
  mockGetStatus: vi.fn(),
}));

vi.mock('./components/modal.js', () => ({
  showConfirmDialog: mockShowConfirmDialog,
}));

vi.mock('./session-activity.js', () => ({
  getStatus: mockGetStatus,
}));

import { appState, _resetForTesting } from './state';
import {
  closeSessionWithConfirm,
  confirmAppClose,
  needsCloseConfirmation,
} from './session-close';

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  mockGetStatus.mockReturnValue('idle');
  _resetForTesting();
});

function seedProject(sessionCount: number) {
  const project = appState.addProject('P', '/p');
  const sessions = [];
  for (let i = 0; i < sessionCount; i++) {
    sessions.push(appState.addSession(project.id, `S${i + 1}`)!);
  }
  return { project, sessions };
}

function confirmDialog() {
  expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
  const [, , options] = mockShowConfirmDialog.mock.calls[0];
  options.onConfirm();
}

describe('closeSessionWithConfirm', () => {
  it.each(['waiting', 'idle', 'completed'] as const)(
    'closes directly when status is %s',
    (status) => {
      const { project, sessions } = seedProject(1);
      mockGetStatus.mockReturnValue(status);

      closeSessionWithConfirm(project.id, sessions[0].id);

      expect(mockShowConfirmDialog).not.toHaveBeenCalled();
      expect(project.sessions).toHaveLength(0);
    },
  );

  it('shows dialog when session is working; confirm removes it', () => {
    const { project, sessions } = seedProject(1);
    mockGetStatus.mockReturnValue('working');

    closeSessionWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Close session');
    expect(message).toContain('S1');
    expect(message).toContain('still active');
    expect(options.confirmLabel).toBe('Close');
    expect(project.sessions).toHaveLength(1);

    options.onConfirm();
    expect(project.sessions).toHaveLength(0);
  });

  it('shows dialog when session is awaiting input; confirm removes it', () => {
    const { project, sessions } = seedProject(1);
    mockGetStatus.mockReturnValue('input');

    closeSessionWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Close session');
    expect(message).toContain('S1');
    expect(message).toContain('still active');
    expect(options.confirmLabel).toBe('Close');
    expect(project.sessions).toHaveLength(1);

    options.onConfirm();
    expect(project.sessions).toHaveLength(0);
  });

  it('does not remove session if user cancels (onConfirm never invoked)', () => {
    const { project, sessions } = seedProject(1);
    mockGetStatus.mockReturnValue('working');

    closeSessionWithConfirm(project.id, sessions[0].id);

    expect(project.sessions).toHaveLength(1);
  });

  it('bypasses dialog when preference is off, even if working', () => {
    const { project, sessions } = seedProject(1);
    appState.setPreference('confirmCloseWorkingSession', false);
    mockGetStatus.mockReturnValue('working');

    closeSessionWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(project.sessions).toHaveLength(0);
  });

  it('bypasses dialog when preference is off, even if awaiting input', () => {
    const { project, sessions } = seedProject(1);
    appState.setPreference('confirmCloseWorkingSession', false);
    mockGetStatus.mockReturnValue('input');

    closeSessionWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(project.sessions).toHaveLength(0);
  });
});

describe('confirmAppClose', () => {
  it('calls onConfirm immediately when no sessions are active', () => {
    const projectA = appState.addProject('A', '/a');
    appState.addSession(projectA.id, 'A1');
    const projectB = appState.addProject('B', '/b');
    appState.addSession(projectB.id, 'B1');
    mockGetStatus.mockReturnValue('idle');
    const onConfirm = vi.fn();

    confirmAppClose(onConfirm);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm immediately when preference is off, even if sessions are working', () => {
    const { sessions } = seedProject(2);
    appState.setPreference('confirmCloseWorkingSession', false);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[0].id ? 'working' : 'idle',
    );
    const onConfirm = vi.fn();

    confirmAppClose(onConfirm);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows singular dialog when exactly one session is working', () => {
    const { sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[1].id ? 'working' : 'idle',
    );
    const onConfirm = vi.fn();

    confirmAppClose(onConfirm);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Quit Vibeyard');
    expect(message).toBe('A session is still active. Quitting will interrupt it.');
    expect(options.confirmLabel).toBe('Quit');
    expect(onConfirm).not.toHaveBeenCalled();

    options.onConfirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('counts input status as active', () => {
    const { sessions } = seedProject(2);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[0].id ? 'input' : 'idle',
    );
    const onConfirm = vi.fn();

    confirmAppClose(onConfirm);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    const [, message] = mockShowConfirmDialog.mock.calls[0];
    expect(message).toContain('A session is still active');
  });

  it('counts active sessions across multiple projects with plural copy', () => {
    const projectA = appState.addProject('A', '/a');
    const a1 = appState.addSession(projectA.id, 'A1')!;
    appState.addSession(projectA.id, 'A2');
    const projectB = appState.addProject('B', '/b');
    const b1 = appState.addSession(projectB.id, 'B1')!;
    const b2 = appState.addSession(projectB.id, 'B2')!;
    mockGetStatus.mockImplementation((id: string) => {
      if (id === a1.id) return 'working';
      if (id === b1.id) return 'working';
      if (id === b2.id) return 'input';
      return 'idle';
    });
    const onConfirm = vi.fn();

    confirmAppClose(onConfirm);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Quit Vibeyard');
    expect(message).toBe('3 sessions are still active. Quitting will interrupt them.');
    expect(options.confirmLabel).toBe('Quit');
  });

  it('does not call onConfirm when user cancels (onConfirm never invoked on dialog)', () => {
    const { sessions } = seedProject(1);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[0].id ? 'working' : 'idle',
    );
    const onConfirm = vi.fn();

    confirmAppClose(onConfirm);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('needsCloseConfirmation', () => {
  it('is true for working and input sessions when the preference is on', () => {
    const { sessions } = seedProject(2);
    appState.setPreference('confirmCloseWorkingSession', true);
    mockGetStatus.mockImplementation((id: string) => (id === sessions[0].id ? 'working' : 'input'));
    expect(needsCloseConfirmation(sessions[0].id)).toBe(true);
    expect(needsCloseConfirmation(sessions[1].id)).toBe(true);
  });

  it('is false for waiting and never-started sessions', () => {
    const { sessions } = seedProject(1);
    appState.setPreference('confirmCloseWorkingSession', true);
    mockGetStatus.mockReturnValue('waiting');
    expect(needsCloseConfirmation(sessions[0].id)).toBe(false);
    mockGetStatus.mockReturnValue('idle');
    expect(needsCloseConfirmation('never-started')).toBe(false);
  });

  it('is false for everything when the preference is off', () => {
    const { sessions } = seedProject(1);
    appState.setPreference('confirmCloseWorkingSession', false);
    mockGetStatus.mockReturnValue('working');
    expect(needsCloseConfirmation(sessions[0].id)).toBe(false);
  });
});
