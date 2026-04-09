import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sentMessages: Array<{ msg: unknown }> = [];

vi.mock('./webrtc-utils.js', () => ({
  ICE_CONFIG: {},
  sendMessage: vi.fn((_dc: unknown, msg: unknown) => {
    sentMessages.push({ msg });
  }),
  waitForIceGathering: vi.fn(async () => {}),
  encodeConnectionCode: vi.fn(async () => 'encoded-offer'),
  decodeConnectionCode: vi.fn(async () => ({ type: 'answer', sdp: 'v=0' })),
}));

vi.mock('./share-crypto.js', () => ({
  generateChallenge: vi.fn(() => new Uint8Array(32).fill(7)),
  computeChallengeResponse: vi.fn(async () => 'expected-response'),
  bytesToHex: vi.fn(() => 'deadbeef'),
  hexToBytes: vi.fn((h: string) => new Uint8Array([h.length])),
}));

const terminalMock = {
  cols: 80,
  rows: 24,
  loadAddon: vi.fn(),
};

vi.mock('../components/terminal-pane.js', () => ({
  getTerminalInstance: vi.fn((sessionId: string) => {
    if (sessionId === 'missing') return undefined;
    return {
      terminal: terminalMock,
      sessionId: 'remote-session-name',
    };
  }),
}));

const serializeReturn = { value: 'short-scrollback' };
vi.mock('@xterm/addon-serialize', () => ({
  SerializeAddon: class {
    serialize() {
      return serializeReturn.value;
    }
    dispose() {}
  },
}));

import {
  startShare,
  stopShare,
  broadcastData,
  broadcastResize,
  isSharing,
  isConnected,
  getShareMode,
  _resetForTesting,
} from './peer-host.js';

interface FakeDC {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  readyState: 'open' | 'closed';
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

interface FakePC {
  createDataChannel: ReturnType<typeof vi.fn>;
  createOffer: ReturnType<typeof vi.fn>;
  setLocalDescription: ReturnType<typeof vi.fn>;
  setRemoteDescription: ReturnType<typeof vi.fn>;
  localDescription: RTCSessionDescription;
  close: ReturnType<typeof vi.fn>;
  oniceconnectionstatechange: (() => void) | null;
  iceConnectionState: RTCIceConnectionState;
}

let lastPc: FakePC | null = null;
let lastDc: FakeDC | null = null;
const ptyWrite = vi.fn();

beforeEach(() => {
  serializeReturn.value = 'short-scrollback';
  _resetForTesting();
  sentMessages.length = 0;

  ptyWrite.mockReset();
  vi.stubGlobal('window', { vibeyard: { pty: { write: ptyWrite } } });

  class FakeRTCPeerConnection {
    iceConnectionState: RTCIceConnectionState = 'new';
    oniceconnectionstatechange: (() => void) | null = null;
    localDescription = { type: 'offer', sdp: 'v=0' } as unknown as RTCSessionDescription;
    createDataChannel = vi.fn(() => {
      const dc: FakeDC = {
        send: vi.fn(),
        close: vi.fn(),
        readyState: 'open',
        onopen: null,
        onmessage: null,
        onclose: null,
      };
      lastDc = dc;
      return dc;
    });
    createOffer = vi.fn(async () => ({ type: 'offer', sdp: 'v=0' }));
    setLocalDescription = vi.fn(async () => {});
    setRemoteDescription = vi.fn(async () => {});
    close = vi.fn();
    constructor() {
      lastPc = this as unknown as FakePC;
    }
  }

  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakeRTCPeerConnection;
  (globalThis as unknown as { RTCSessionDescription: unknown }).RTCSessionDescription = class {
    constructor(public init: RTCSessionDescriptionInit) {}
  };
});

afterEach(() => {
  vi.useRealTimers();
  lastPc = null;
  lastDc = null;
});

function deliver(msg: unknown): void {
  lastDc!.onmessage?.({ data: JSON.stringify(msg) });
}

describe('startShare', () => {
  it('throws when no terminal instance is available', () => {
    expect(() => startShare('missing', 'readonly', '1234')).toThrow(/No terminal instance/);
  });

  it('sends an auth-challenge when the data channel opens', () => {
    startShare('s1', 'readonly', '1234');
    lastDc!.onopen?.();
    expect(sentMessages[0].msg).toMatchObject({ type: 'auth-challenge', challenge: 'deadbeef' });
    expect(isSharing('s1')).toBe(true);
    expect(getShareMode('s1')).toBe('readonly');
    expect(isConnected('s1')).toBe(true);
  });

  it('emits onConnected + sends init once auth succeeds', async () => {
    const handle = startShare('s1', 'readwrite', '1234');
    const connectedCb = vi.fn();
    handle.onConnected(connectedCb);
    lastDc!.onopen?.();
    deliver({ type: 'auth-response', response: 'expected-response' });
    // computeChallengeResponse is mocked async
    await new Promise((r) => setTimeout(r, 0));
    expect(sentMessages.some((s) => (s.msg as { type: string }).type === 'auth-result')).toBe(true);
    const initMsg = sentMessages.find((s) => (s.msg as { type: string }).type === 'init');
    expect(initMsg).toBeDefined();
    expect((initMsg!.msg as { scrollback: string }).scrollback).toBe('short-scrollback');
    expect(connectedCb).toHaveBeenCalled();
  });

  it('chunks scrollback when it exceeds CHUNK_SIZE', async () => {
    serializeReturn.value = 'x'.repeat(64 * 1024 + 10);
    const handle = startShare('s1', 'readonly', '1234');
    lastDc!.onopen?.();
    deliver({ type: 'auth-response', response: 'expected-response' });
    await new Promise((r) => setTimeout(r, 0));
    const initMsg = sentMessages.find((s) => (s.msg as { type: string }).type === 'init');
    expect(initMsg).toBeDefined();
    // init message should have empty scrollback; data messages carry chunks
    expect((initMsg!.msg as { scrollback: string }).scrollback).toBe('');
    const dataMsgs = sentMessages.filter((s) => (s.msg as { type: string }).type === 'data');
    expect(dataMsgs.length).toBe(2);
  });

  it('fires authFailed and stops on wrong response', async () => {
    const handle = startShare('s1', 'readonly', '1234');
    const authFailed = vi.fn();
    handle.onAuthFailed(authFailed);
    lastDc!.onopen?.();
    deliver({ type: 'auth-response', response: 'wrong' });
    await new Promise((r) => setTimeout(r, 0));
    expect(authFailed).toHaveBeenCalledWith('Passphrase mismatch');
    expect(isSharing('s1')).toBe(false);
  });

  it('fires authFailed on auth timeout', async () => {
    vi.useFakeTimers();
    const handle = startShare('s1', 'readonly', '1234');
    const authFailed = vi.fn();
    handle.onAuthFailed(authFailed);
    lastDc!.onopen?.();
    vi.advanceTimersByTime(10_000);
    expect(authFailed).toHaveBeenCalledWith('Authentication timed out');
    expect(isSharing('s1')).toBe(false);
  });

  it('ignores non-auth messages before verification', () => {
    startShare('s1', 'readwrite', '1234');
    lastDc!.onopen?.();
    sentMessages.length = 0;
    deliver({ type: 'input', payload: 'rm -rf /' });
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it('forwards input to pty after verification in readwrite mode', async () => {
    startShare('s1', 'readwrite', '1234');
    lastDc!.onopen?.();
    deliver({ type: 'auth-response', response: 'expected-response' });
    await new Promise((r) => setTimeout(r, 0));
    deliver({ type: 'input', payload: 'ls' });
    expect(ptyWrite).toHaveBeenCalledWith('s1', 'ls');
  });

  it('does not forward input in readonly mode', async () => {
    startShare('s1', 'readonly', '1234');
    lastDc!.onopen?.();
    deliver({ type: 'auth-response', response: 'expected-response' });
    await new Promise((r) => setTimeout(r, 0));
    deliver({ type: 'input', payload: 'ls' });
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it('resets missedPongs when a pong is received', async () => {
    vi.useFakeTimers();
    startShare('s1', 'readonly', '1234');
    lastDc!.onopen?.();
    deliver({ type: 'auth-response', response: 'expected-response' });
    // Flush the async auth promise microtask
    await Promise.resolve();
    await Promise.resolve();
    // Advance 30s to trigger a ping (missedPongs becomes 1)
    vi.advanceTimersByTime(30_000);
    deliver({ type: 'pong' });
    // Two more intervals: missedPongs 0→1→2, still <= 3 → still sharing
    vi.advanceTimersByTime(30_000);
    vi.advanceTimersByTime(30_000);
    expect(isSharing('s1')).toBe(true);
  });

  it('disconnects after MAX_MISSED_PONGS exceeded', async () => {
    vi.useFakeTimers();
    startShare('s1', 'readonly', '1234');
    lastDc!.onopen?.();
    deliver({ type: 'auth-response', response: 'expected-response' });
    await Promise.resolve();
    await Promise.resolve();
    // 4 intervals with no pongs → missedPongs goes 1,2,3,4 → 4 > 3 → stop
    for (let i = 0; i < 4; i++) vi.advanceTimersByTime(30_000);
    expect(isSharing('s1')).toBe(false);
  });
});

describe('broadcast / query helpers', () => {
  it('broadcastData is a no-op when not connected', () => {
    broadcastData('s1', 'hello');
    expect(sentMessages).toHaveLength(0);
  });

  it('broadcastData sends when connected', async () => {
    startShare('s1', 'readonly', '1234');
    lastDc!.onopen?.();
    sentMessages.length = 0;
    broadcastData('s1', 'hello');
    expect(sentMessages).toContainEqual({ msg: { type: 'data', payload: 'hello' } });
  });

  it('broadcastResize is a no-op when not connected', () => {
    broadcastResize('s1', 80, 24);
    expect(sentMessages).toHaveLength(0);
  });

  it('broadcastResize sends when connected', async () => {
    startShare('s1', 'readonly', '1234');
    lastDc!.onopen?.();
    sentMessages.length = 0;
    broadcastResize('s1', 100, 30);
    expect(sentMessages).toContainEqual({ msg: { type: 'resize', cols: 100, rows: 30 } });
  });

  it('isSharing/isConnected/getShareMode return defaults for unknown session', () => {
    expect(isSharing('nope')).toBe(false);
    expect(isConnected('nope')).toBe(false);
    expect(getShareMode('nope')).toBeNull();
  });
});

describe('stopShare', () => {
  it('sends end frame and cleans up when stopping a connected share', () => {
    startShare('s1', 'readonly', '1234');
    lastDc!.onopen?.();
    sentMessages.length = 0;
    stopShare('s1');
    expect(sentMessages.some((s) => (s.msg as { type: string }).type === 'end')).toBe(true);
    expect(isSharing('s1')).toBe(false);
  });

  it('is a no-op for unknown session', () => {
    expect(() => stopShare('nope')).not.toThrow();
  });

  it('closes existing share when startShare is called on the same sessionId', () => {
    startShare('s1', 'readonly', '1234');
    const firstDc = lastDc!;
    lastDc!.onopen?.();
    startShare('s1', 'readwrite', '1234');
    expect(firstDc.close).toHaveBeenCalled();
    expect(getShareMode('s1')).toBe('readwrite');
  });
});

describe('getOffer / acceptAnswer', () => {
  it('getOffer produces the encoded offer', async () => {
    const handle = startShare('s1', 'readonly', '1234');
    const offer = await handle.getOffer();
    expect(offer).toBe('encoded-offer');
  });

  it('acceptAnswer decodes and sets the remote description', async () => {
    const handle = startShare('s1', 'readonly', '1234');
    await handle.acceptAnswer('answer-code');
    expect(lastPc!.setRemoteDescription).toHaveBeenCalled();
  });
});

describe('ICE disconnect', () => {
  it('fires onDisconnected when ICE transitions to failed', () => {
    const handle = startShare('s1', 'readonly', '1234');
    const onDisc = vi.fn();
    handle.onDisconnected(onDisc);
    lastDc!.onopen?.();
    (lastPc as unknown as { iceConnectionState: RTCIceConnectionState }).iceConnectionState = 'failed';
    lastPc!.oniceconnectionstatechange?.();
    expect(onDisc).toHaveBeenCalledTimes(1);
  });
});
