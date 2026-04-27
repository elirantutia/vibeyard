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
  closeAllSessionsWithConfirm,
  closeOtherSessionsWithConfirm,
  closeSessionsFromRightWithConfirm,
  closeSessionsFromLeftWithConfirm,
  confirmAppClose,
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

describe('closeAllSessionsWithConfirm', () => {
  it('closes all directly when none are active', () => {
    const { project } = seedProject(3);
    mockGetStatus.mockReturnValue('waiting');

    closeAllSessionsWithConfirm(project.id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(project.sessions).toHaveLength(0);
  });

  it('shows singular dialog when exactly one session is working', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[1].id ? 'working' : 'idle',
    );

    closeAllSessionsWithConfirm(project.id);

    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Close session');
    expect(message).toContain('S2');
    expect(options.confirmLabel).toBe('Close');
  });

  it('shows singular dialog when exactly one session is awaiting input', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[2].id ? 'input' : 'idle',
    );

    closeAllSessionsWithConfirm(project.id);

    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Close session');
    expect(message).toContain('S3');
    expect(options.confirmLabel).toBe('Close');
  });

  it('shows plural dialog with count when multiple sessions are working', () => {
    const { project } = seedProject(3);
    mockGetStatus.mockReturnValue('working');

    closeAllSessionsWithConfirm(project.id);

    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Close sessions');
    expect(message).toContain('3 sessions');
    expect(options.confirmLabel).toBe('Close all');

    options.onConfirm();
    expect(project.sessions).toHaveLength(0);
  });

  it('shows plural dialog when sessions mix working and input statuses', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) => {
      if (id === sessions[0].id) return 'working';
      if (id === sessions[1].id) return 'input';
      return 'idle';
    });

    closeAllSessionsWithConfirm(project.id);

    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Close sessions');
    expect(message).toContain('2 sessions');
    expect(message).toContain('still active');
    expect(options.confirmLabel).toBe('Close all');
  });
});

describe('closeOtherSessionsWithConfirm', () => {
  it('only considers active sessions outside the kept one', () => {
    const { project, sessions } = seedProject(3);
    // Mark the kept session as working — should NOT trigger dialog
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[0].id ? 'working' : 'idle',
    );

    closeOtherSessionsWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    // Kept session remains; others removed
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[0].id]);
  });

  it('ignores input status on the kept session', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[0].id ? 'input' : 'idle',
    );

    closeOtherSessionsWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[0].id]);
  });

  it('prompts when a non-kept session is working', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[1].id ? 'working' : 'idle',
    );

    closeOtherSessionsWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    confirmDialog();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[0].id]);
  });

  it('prompts when a non-kept session is awaiting input', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[1].id ? 'input' : 'idle',
    );

    closeOtherSessionsWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    confirmDialog();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[0].id]);
  });
});

describe('closeSessionsFromRightWithConfirm', () => {
  it('ignores a working session to the left of the anchor', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[0].id ? 'working' : 'idle',
    );

    closeSessionsFromRightWithConfirm(project.id, sessions[1].id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[0].id, sessions[1].id]);
  });

  it('prompts when a session to the right is working', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[2].id ? 'working' : 'idle',
    );

    closeSessionsFromRightWithConfirm(project.id, sessions[1].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    confirmDialog();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[0].id, sessions[1].id]);
  });

  it('prompts when a session to the right is awaiting input', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[2].id ? 'input' : 'idle',
    );

    closeSessionsFromRightWithConfirm(project.id, sessions[1].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    confirmDialog();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[0].id, sessions[1].id]);
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

describe('closeSessionsFromLeftWithConfirm', () => {
  it('ignores a working session to the right of the anchor', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[2].id ? 'working' : 'idle',
    );

    closeSessionsFromLeftWithConfirm(project.id, sessions[1].id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[1].id, sessions[2].id]);
  });

  it('prompts when a session to the left is working', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[0].id ? 'working' : 'idle',
    );

    closeSessionsFromLeftWithConfirm(project.id, sessions[1].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    confirmDialog();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[1].id, sessions[2].id]);
  });

  it('prompts when a session to the left is awaiting input', () => {
    const { project, sessions } = seedProject(3);
    mockGetStatus.mockImplementation((id: string) =>
      id === sessions[0].id ? 'input' : 'idle',
    );

    closeSessionsFromLeftWithConfirm(project.id, sessions[1].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    confirmDialog();
    expect(project.sessions.map((s) => s.id)).toEqual([sessions[1].id, sessions[2].id]);
  });
});
