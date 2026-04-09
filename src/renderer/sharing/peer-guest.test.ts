import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock helper modules so we don't exercise real crypto/webrtc utils
const sentMessages: Array<{ dc: unknown; msg: unknown }> = [];
vi.mock('./webrtc-utils.js', () => ({
  ICE_CONFIG: {},
  sendMessage: vi.fn((dc: unknown, msg: unknown) => {
    sentMessages.push({ dc, msg });
  }),
  waitForIceGathering: vi.fn(async () => {}),
  encodeConnectionCode: vi.fn(async () => 'encoded-answer'),
  decodeConnectionCode: vi.fn(async () => ({ type: 'offer', sdp: 'v=0' })),
}));

vi.mock('./share-crypto.js', () => ({
  hexToBytes: vi.fn((hex: string) => new Uint8Array([hex.length])),
  computeChallengeResponse: vi.fn(async () => 'response-hex'),
}));

import { joinShare, _resetForTesting } from './peer-guest.js';

// ---- RTCPeerConnection / RTCDataChannel stubs ----
interface FakeDataChannel {
  readyState: 'open' | 'closed';
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onclose: (() => void) | null;
}

interface FakePeerConnection {
  ondatachannel: ((ev: { channel: FakeDataChannel }) => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  iceConnectionState: RTCIceConnectionState;
  setRemoteDescription: ReturnType<typeof vi.fn>;
  setLocalDescription: ReturnType<typeof vi.fn>;
  createAnswer: ReturnType<typeof vi.fn>;
  localDescription: RTCSessionDescription | null;
  close: ReturnType<typeof vi.fn>;
}

let lastPc: FakePeerConnection | null = null;

function makeDC(): FakeDataChannel {
  return {
    readyState: 'open',
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
  };
}

beforeEach(() => {
  sentMessages.length = 0;
  _resetForTesting();

  class FakeRTCPeerConnection {
    ondatachannel: FakePeerConnection['ondatachannel'] = null;
    oniceconnectionstatechange: FakePeerConnection['oniceconnectionstatechange'] = null;
    iceConnectionState: RTCIceConnectionState = 'new';
    setRemoteDescription = vi.fn(async () => {});
    setLocalDescription = vi.fn(async () => {});
    createAnswer = vi.fn(async () => ({ type: 'answer', sdp: 'v=0' }));
    localDescription = { type: 'answer', sdp: 'v=0' } as unknown as RTCSessionDescription;
    close = vi.fn();
    constructor() {
      lastPc = this as unknown as FakePeerConnection;
    }
  }

  (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection = FakeRTCPeerConnection;
  (globalThis as unknown as { RTCSessionDescription: unknown }).RTCSessionDescription = class {
    constructor(public init: RTCSessionDescriptionInit) {}
  };
});

afterEach(() => {
  lastPc = null;
});

function deliver(dc: FakeDataChannel, msg: unknown): void {
  dc.onmessage?.({ data: JSON.stringify(msg) });
}

function attachChannel(): FakeDataChannel {
  const dc = makeDC();
  lastPc!.ondatachannel?.({ channel: dc });
  dc.onopen?.();
  return dc;
}

describe('joinShare', () => {
  it('returns a unique guestId and a handle', () => {
    const a = joinShare('offer-code', '1234');
    const b = joinShare('offer-code', '1234');
    expect(a.guestId).not.toBe(b.guestId);
    expect(typeof a.handle.getAnswer).toBe('function');
  });

  it('getAnswer decodes the offer and produces an encoded answer', async () => {
    const { handle } = joinShare('offer-code', '1234');
    const answer = await handle.getAnswer();
    expect(answer).toBe('encoded-answer');
    expect(lastPc!.setRemoteDescription).toHaveBeenCalled();
    expect(lastPc!.createAnswer).toHaveBeenCalled();
    expect(lastPc!.setLocalDescription).toHaveBeenCalled();
  });

  it('responds to an auth-challenge with an auth-response', async () => {
    const { handle } = joinShare('offer-code', '1234');
    void handle.getAnswer();
    const dc = attachChannel();
    deliver(dc, { type: 'auth-challenge', challenge: 'deadbeef' });
    // sendMessage is async because computeChallengeResponse is mocked as async
    await new Promise((r) => setTimeout(r, 0));
    const sent = sentMessages.find((s) => (s.msg as { type: string }).type === 'auth-response');
    expect(sent).toBeDefined();
    expect((sent!.msg as { response: string }).response).toBe('response-hex');
  });

  it('fires onAuthFailed and disconnects when auth-result.ok is false', () => {
    const { handle } = joinShare('offer-code', '1234');
    const authFailed = vi.fn();
    handle.onAuthFailed(authFailed);
    const dc = attachChannel();
    deliver(dc, { type: 'auth-result', ok: false, reason: 'bad PIN' });
    expect(authFailed).toHaveBeenCalledWith('bad PIN');
    expect(dc.close).toHaveBeenCalled();
    expect(lastPc!.close).toHaveBeenCalled();
  });

  it('ignores non-auth messages before authentication completes', () => {
    const { handle } = joinShare('offer-code', '1234');
    const onData = vi.fn();
    handle.onData(onData);
    const dc = attachChannel();
    deliver(dc, { type: 'data', payload: 'should-be-ignored' });
    expect(onData).not.toHaveBeenCalled();
  });

  it('routes init/data/resize/end messages after successful auth', () => {
    const { handle } = joinShare('offer-code', '1234');
    const onInit = vi.fn();
    const onData = vi.fn();
    const onResize = vi.fn();
    const onEnd = vi.fn();
    handle.onInit(onInit);
    handle.onData(onData);
    handle.onResize(onResize);
    handle.onEnd(onEnd);
    const dc = attachChannel();
    deliver(dc, { type: 'auth-result', ok: true });
    deliver(dc, {
      type: 'init',
      scrollback: 'hello',
      mode: 'readwrite',
      cols: 80,
      rows: 24,
      sessionName: 'test',
    });
    expect(onInit).toHaveBeenCalledWith({
      scrollback: 'hello',
      mode: 'readwrite',
      cols: 80,
      rows: 24,
      sessionName: 'test',
    });
    deliver(dc, { type: 'data', payload: 'chunk' });
    expect(onData).toHaveBeenCalledWith('chunk');
    deliver(dc, { type: 'resize', cols: 100, rows: 30 });
    expect(onResize).toHaveBeenCalledWith(100, 30);
    deliver(dc, { type: 'end' });
    expect(onEnd).toHaveBeenCalled();
  });

  it('replies to ping with a pong after auth', () => {
    const { handle } = joinShare('offer-code', '1234');
    void handle;
    const dc = attachChannel();
    deliver(dc, { type: 'auth-result', ok: true });
    sentMessages.length = 0;
    deliver(dc, { type: 'ping' });
    expect(sentMessages.some((s) => (s.msg as { type: string }).type === 'pong')).toBe(true);
  });

  it('ignores malformed JSON without throwing', () => {
    joinShare('offer-code', '1234');
    const dc = attachChannel();
    expect(() => dc.onmessage?.({ data: 'not-json' })).not.toThrow();
  });

  describe('sendInput', () => {
    it('is a no-op in readonly mode', () => {
      const { handle } = joinShare('offer-code', '1234');
      const dc = attachChannel();
      deliver(dc, { type: 'auth-result', ok: true });
      deliver(dc, {
        type: 'init',
        scrollback: '',
        mode: 'readonly',
        cols: 80,
        rows: 24,
        sessionName: 'test',
      });
      sentMessages.length = 0;
      handle.sendInput('a');
      expect(sentMessages).toHaveLength(0);
    });

    it('sends an input message in readwrite mode', () => {
      const { handle } = joinShare('offer-code', '1234');
      const dc = attachChannel();
      deliver(dc, { type: 'auth-result', ok: true });
      deliver(dc, {
        type: 'init',
        scrollback: '',
        mode: 'readwrite',
        cols: 80,
        rows: 24,
        sessionName: 'test',
      });
      sentMessages.length = 0;
      handle.sendInput('hi');
      expect(sentMessages).toContainEqual(
        expect.objectContaining({ msg: { type: 'input', payload: 'hi' } }),
      );
    });

    it('is a no-op before connection is open', () => {
      const { handle } = joinShare('offer-code', '1234');
      handle.sendInput('x');
      expect(sentMessages).toHaveLength(0);
    });
  });

  describe('disconnect', () => {
    it('fires onDisconnected exactly once even when called multiple times', () => {
      const { handle } = joinShare('offer-code', '1234');
      const onDisc = vi.fn();
      handle.onDisconnected(onDisc);
      const dc = attachChannel();
      dc.onclose?.();
      dc.onclose?.();
      expect(onDisc).toHaveBeenCalledTimes(1);
    });

    it('also fires on ICE disconnected state', () => {
      const { handle } = joinShare('offer-code', '1234');
      const onDisc = vi.fn();
      handle.onDisconnected(onDisc);
      attachChannel();
      (lastPc as unknown as { iceConnectionState: RTCIceConnectionState }).iceConnectionState = 'failed';
      lastPc!.oniceconnectionstatechange?.();
      expect(onDisc).toHaveBeenCalledTimes(1);
    });

    it('manual disconnect() closes the connection', () => {
      const { handle } = joinShare('offer-code', '1234');
      attachChannel();
      handle.disconnect();
      expect(lastPc!.close).toHaveBeenCalled();
    });
  });

  describe('_resetForTesting', () => {
    it('disconnects all active guests and resets the id counter', () => {
      joinShare('offer-code', '1234');
      attachChannel();
      const pcRef = lastPc!;
      _resetForTesting();
      expect(pcRef.close).toHaveBeenCalled();
      // counter should restart
      const fresh = joinShare('offer-code', '1234');
      expect(fresh.guestId).toBe('guest-1');
    });
  });
});
