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
  it('closes directly when status is not working', () => {
    const { project, sessions } = seedProject(1);
    mockGetStatus.mockReturnValue('idle');

    closeSessionWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).not.toHaveBeenCalled();
    expect(project.sessions).toHaveLength(0);
  });

  it('shows dialog when session is working; confirm removes it', () => {
    const { project, sessions } = seedProject(1);
    mockGetStatus.mockReturnValue('working');

    closeSessionWithConfirm(project.id, sessions[0].id);

    expect(mockShowConfirmDialog).toHaveBeenCalledTimes(1);
    const [title, message, options] = mockShowConfirmDialog.mock.calls[0];
    expect(title).toBe('Close session');
    expect(message).toContain('S1');
    expect(message).toContain('still working');
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
});

describe('closeAllSessionsWithConfirm', () => {
  it('closes all directly when none are working', () => {
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
});

describe('closeOtherSessionsWithConfirm', () => {
  it('only considers working sessions outside the kept one', () => {
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
});
