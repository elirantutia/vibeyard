import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- mocks for peer-host, peer-guest, appState, remote-terminal-pane ----

const { hostState, joinShareMock, appStateListeners, appStateMock, remoteTerm, lastJoinHandleRef } = vi.hoisted(() => {
  const hostState = {
    startShare: vi.fn(),
    stopShare: vi.fn(),
    broadcastData: vi.fn(),
    broadcastResize: vi.fn(),
    isSharing: vi.fn(),
  };
  const lastJoinHandleRef: { current: FakeJoinHandleT | null } = { current: null };
  type FakeJoinHandleT = {
    getAnswer: ReturnType<typeof vi.fn>;
    sendInput: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onInit: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onResize: ReturnType<typeof vi.fn>;
    onDisconnected: ReturnType<typeof vi.fn>;
    onEnd: ReturnType<typeof vi.fn>;
    onAuthFailed: ReturnType<typeof vi.fn>;
    __fireInit: ((d: unknown) => void) | null;
    __fireDisconnect: (() => void) | null;
    __fireData: ((p: string) => void) | null;
  };
  const joinShareMock = vi.fn(() => {
    const handle: FakeJoinHandleT = {
      getAnswer: vi.fn(async () => 'fake-answer'),
      sendInput: vi.fn(),
      disconnect: vi.fn(),
      onInit: vi.fn((cb: (d: unknown) => void) => {
        handle.__fireInit = cb;
      }),
      onData: vi.fn((cb: (p: string) => void) => {
        handle.__fireData = cb;
      }),
      onResize: vi.fn(),
      onDisconnected: vi.fn((cb: () => void) => {
        handle.__fireDisconnect = cb;
      }),
      onEnd: vi.fn(),
      onAuthFailed: vi.fn(),
      __fireInit: null,
      __fireDisconnect: null,
      __fireData: null,
    };
    lastJoinHandleRef.current = handle;
    return { guestId: 'guest-1', handle };
  });
  const appStateListeners = new Map<string, Array<(data?: unknown) => void>>();
  const appStateMock = {
    on: vi.fn((ev: string, cb: (data?: unknown) => void) => {
      if (!appStateListeners.has(ev)) appStateListeners.set(ev, []);
      appStateListeners.get(ev)!.push(cb);
    }),
    addRemoteSession: vi.fn(() => ({ id: 'remote-local-id' })),
  };
  const remoteTerm = {
    createRemoteTerminalPane: vi.fn(),
    writeRemoteData: vi.fn(),
    showRemoteEndOverlay: vi.fn(),
    destroyRemoteTerminal: vi.fn(),
  };
  return { hostState, joinShareMock, appStateListeners, appStateMock, remoteTerm, lastJoinHandleRef };
});

vi.mock('./peer-host.js', () => hostState);

vi.mock('./peer-guest.js', () => ({ joinShare: joinShareMock }));
vi.mock('../state.js', () => ({ appState: appStateMock }));
vi.mock('../components/remote-terminal-pane.js', () => remoteTerm);

const lastJoinHandle = () => lastJoinHandleRef.current!;

// ---- import SUT ----
import {
  shareSession,
  acceptShareAnswer,
  endShare,
  forwardPtyData,
  forwardResize,
  joinRemoteSession,
  disconnectRemoteSession,
  isRemoteSession,
  initShareManager,
  cleanupAllShares,
  onShareChange,
  _resetForTesting,
} from './share-manager.js';

// ---- helpers ----

interface FakeShareHandle {
  getOffer: ReturnType<typeof vi.fn>;
  acceptAnswer: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onConnected: ReturnType<typeof vi.fn>;
  onDisconnected: ReturnType<typeof vi.fn>;
  onAuthFailed: ReturnType<typeof vi.fn>;
  __fireConnected: (() => void) | null;
  __fireDisconnected: (() => void) | null;
}

function makeShareHandle(): FakeShareHandle {
  const h: FakeShareHandle = {
    getOffer: vi.fn(async () => 'fake-offer'),
    acceptAnswer: vi.fn(async () => {}),
    stop: vi.fn(),
    onConnected: vi.fn((cb: () => void) => {
      h.__fireConnected = cb;
    }),
    onDisconnected: vi.fn((cb: () => void) => {
      h.__fireDisconnected = cb;
    }),
    onAuthFailed: vi.fn(),
    __fireConnected: null,
    __fireDisconnected: null,
  };
  return h;
}

beforeEach(() => {
  vi.clearAllMocks();
  appStateListeners.clear();
  _resetForTesting();
  vi.stubGlobal('crypto', { randomUUID: () => 'local-uuid' });
  appStateMock.addRemoteSession.mockReturnValue({ id: 'remote-local-id' });
});

describe('shareSession', () => {
  it('calls startShare, stores handle, notifies listeners, and returns offer', async () => {
    const handle = makeShareHandle();
    hostState.startShare.mockReturnValue(handle);
    const change = vi.fn();
    onShareChange(change);

    const result = await shareSession('s1', 'readonly', '1234');

    expect(hostState.startShare).toHaveBeenCalledWith('s1', 'readonly', '1234');
    expect(result.offer).toBe('fake-offer');
    expect(change).toHaveBeenCalled();
  });

  it('notifies listeners on connect and removes handle on disconnect', async () => {
    const handle = makeShareHandle();
    hostState.startShare.mockReturnValue(handle);
    const change = vi.fn();
    onShareChange(change);

    await shareSession('s1', 'readonly', '1234');
    change.mockClear();

    handle.__fireConnected?.();
    expect(change).toHaveBeenCalledTimes(1);

    handle.__fireDisconnected?.();
    expect(change).toHaveBeenCalledTimes(2);
  });
});

describe('acceptShareAnswer', () => {
  it('delegates to the stored ShareHandle', async () => {
    const handle = makeShareHandle();
    hostState.startShare.mockReturnValue(handle);
    await shareSession('s1', 'readonly', '1234');
    await acceptShareAnswer('s1', 'answer-code');
    expect(handle.acceptAnswer).toHaveBeenCalledWith('answer-code');
  });

  it('throws when no share is active for the session', async () => {
    await expect(acceptShareAnswer('missing', 'answer')).rejects.toThrow(/No active share/);
  });
});

describe('endShare', () => {
  it('calls stopShare and notifies listeners', async () => {
    const handle = makeShareHandle();
    hostState.startShare.mockReturnValue(handle);
    await shareSession('s1', 'readonly', '1234');
    const change = vi.fn();
    onShareChange(change);
    endShare('s1');
    expect(hostState.stopShare).toHaveBeenCalledWith('s1');
    expect(change).toHaveBeenCalled();
  });
});

describe('forwardPtyData / forwardResize', () => {
  it('delegates to broadcastData', () => {
    forwardPtyData('s1', 'hello');
    expect(hostState.broadcastData).toHaveBeenCalledWith('s1', 'hello');
  });

  it('delegates to broadcastResize', () => {
    forwardResize('s1', 100, 30);
    expect(hostState.broadcastResize).toHaveBeenCalledWith('s1', 100, 30);
  });
});

describe('joinRemoteSession', () => {
  it('returns the answer and waits for init to create the remote pane', async () => {
    const result = await joinRemoteSession('p1', 'offer-code', '1234');
    expect(result.answer).toBe('fake-answer');
    expect(lastJoinHandleRef.current).not.toBeNull();

    lastJoinHandle().__fireInit!({
      scrollback: 'SB',
      mode: 'readwrite',
      cols: 80,
      rows: 24,
      sessionName: 'remote-name',
    });

    expect(remoteTerm.createRemoteTerminalPane).toHaveBeenCalledWith(
      'local-uuid',
      'readwrite',
      80,
      24,
      expect.any(Function),
    );
    expect(remoteTerm.writeRemoteData).toHaveBeenCalledWith('local-uuid', 'SB');
    expect(appStateMock.addRemoteSession).toHaveBeenCalledWith('p1', 'local-uuid', 'remote-name', 'readwrite');
    expect(isRemoteSession('local-uuid')).toBe(true);
  });

  it('invokes onConnected callback after pane is created', async () => {
    const connected = vi.fn();
    await joinRemoteSession('p1', 'offer', '1234', connected);
    lastJoinHandle().__fireInit!({
      scrollback: '',
      mode: 'readonly',
      cols: 80,
      rows: 24,
      sessionName: 'x',
    });
    expect(connected).toHaveBeenCalled();
  });

  it('tears down when addRemoteSession returns null', async () => {
    appStateMock.addRemoteSession.mockReturnValueOnce(null);
    await joinRemoteSession('p1', 'offer', '1234');
    lastJoinHandle().__fireInit!({
      scrollback: '',
      mode: 'readonly',
      cols: 80,
      rows: 24,
      sessionName: 'x',
    });
    expect(remoteTerm.destroyRemoteTerminal).toHaveBeenCalledWith('local-uuid');
    expect(lastJoinHandle().disconnect).toHaveBeenCalled();
    expect(isRemoteSession('local-uuid')).toBe(false);
  });

  it('routes subsequent data messages to writeRemoteData', async () => {
    await joinRemoteSession('p1', 'offer', '1234');
    lastJoinHandle().__fireInit!({
      scrollback: '',
      mode: 'readonly',
      cols: 80,
      rows: 24,
      sessionName: 'x',
    });
    lastJoinHandle().__fireData!('chunk');
    expect(remoteTerm.writeRemoteData).toHaveBeenCalledWith('local-uuid', 'chunk');
  });

  it('shows end overlay when disconnect fires after init', async () => {
    await joinRemoteSession('p1', 'offer', '1234');
    lastJoinHandle().__fireInit!({
      scrollback: '',
      mode: 'readonly',
      cols: 80,
      rows: 24,
      sessionName: 'x',
    });
    lastJoinHandle().__fireDisconnect!();
    expect(remoteTerm.showRemoteEndOverlay).toHaveBeenCalledWith('local-uuid');
    expect(isRemoteSession('local-uuid')).toBe(false);
  });

  it('ignores init when disconnect happened before init (pending dropped)', async () => {
    await joinRemoteSession('p1', 'offer', '1234');
    // Disconnect before init: drops pending
    lastJoinHandle().__fireDisconnect!();
    lastJoinHandle().__fireInit!({
      scrollback: '',
      mode: 'readonly',
      cols: 80,
      rows: 24,
      sessionName: 'x',
    });
    expect(remoteTerm.createRemoteTerminalPane).not.toHaveBeenCalled();
  });
});

describe('disconnectRemoteSession / isRemoteSession', () => {
  it('isRemoteSession returns false when unknown', () => {
    expect(isRemoteSession('nope')).toBe(false);
  });

  it('disconnectRemoteSession calls handle.disconnect and removes entry', async () => {
    await joinRemoteSession('p1', 'offer', '1234');
    lastJoinHandle().__fireInit!({
      scrollback: '',
      mode: 'readonly',
      cols: 80,
      rows: 24,
      sessionName: 'x',
    });
    disconnectRemoteSession('local-uuid');
    expect(lastJoinHandle().disconnect).toHaveBeenCalled();
    expect(isRemoteSession('local-uuid')).toBe(false);
  });

  it('is a no-op for unknown session', () => {
    expect(() => disconnectRemoteSession('nope')).not.toThrow();
  });
});

describe('initShareManager', () => {
  it('removes host share on session-removed when sharing', async () => {
    initShareManager();
    const handle = makeShareHandle();
    hostState.startShare.mockReturnValue(handle);
    hostState.isSharing.mockImplementation((id: string) => id === 's1');
    await shareSession('s1', 'readonly', '1234');

    const listeners = appStateListeners.get('session-removed') ?? [];
    for (const l of listeners) l({ sessionId: 's1' });

    expect(hostState.stopShare).toHaveBeenCalledWith('s1');
  });

  it('ignores session-removed with missing payload', () => {
    initShareManager();
    const listeners = appStateListeners.get('session-removed') ?? [];
    expect(() => {
      for (const l of listeners) l();
    }).not.toThrow();
    expect(() => {
      for (const l of listeners) l({});
    }).not.toThrow();
  });

  it('cleans up guest session on session-removed', async () => {
    initShareManager();
    hostState.isSharing.mockReturnValue(false);
    await joinRemoteSession('p1', 'offer', '1234');
    lastJoinHandle().__fireInit!({
      scrollback: '',
      mode: 'readonly',
      cols: 80,
      rows: 24,
      sessionName: 'x',
    });
    const listeners = appStateListeners.get('session-removed') ?? [];
    for (const l of listeners) l({ sessionId: 'local-uuid' });
    expect(lastJoinHandle().disconnect).toHaveBeenCalled();
    expect(remoteTerm.destroyRemoteTerminal).toHaveBeenCalledWith('local-uuid');
  });
});

describe('cleanupAllShares', () => {
  it('ends all active host shares, guest sessions, and pending joins', async () => {
    hostState.isSharing.mockReturnValue(true);
    const handle = makeShareHandle();
    hostState.startShare.mockReturnValue(handle);
    await shareSession('s1', 'readonly', '1234');

    // Pending join (no init fired)
    await joinRemoteSession('p1', 'offer', '1234');
    const pendingHandle = lastJoinHandle();

    cleanupAllShares();

    expect(hostState.stopShare).toHaveBeenCalledWith('s1');
    expect(pendingHandle.disconnect).toHaveBeenCalled();
  });
});
