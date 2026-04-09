import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ShareMessage } from '../../shared/sharing-types.js';
import {
  ICE_CONFIG,
  sendMessage,
  encodeConnectionCode,
  decodeConnectionCode,
  waitForIceGathering,
} from './webrtc-utils.js';

describe('ICE_CONFIG', () => {
  it('includes a STUN server', () => {
    expect(ICE_CONFIG.iceServers?.[0].urls).toContain('stun:');
  });
});

describe('sendMessage', () => {
  it('sends a JSON-serialized message when channel is open', () => {
    const send = vi.fn();
    const dc = { readyState: 'open', send } as unknown as RTCDataChannel;
    const msg = { type: 'ping' } as unknown as ShareMessage;
    sendMessage(dc, msg);
    expect(send).toHaveBeenCalledWith(JSON.stringify(msg));
  });

  it('is a no-op when channel is not open', () => {
    const send = vi.fn();
    const dc = { readyState: 'connecting', send } as unknown as RTCDataChannel;
    sendMessage(dc, { type: 'ping' } as unknown as ShareMessage);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('encodeConnectionCode / decodeConnectionCode', () => {
  const pin = '1234';

  it('round-trips a valid offer description', async () => {
    const desc = { type: 'offer', sdp: 'v=0\r\n...' } as RTCSessionDescription;
    const code = await encodeConnectionCode(desc, pin);
    const decoded = await decodeConnectionCode(code, 'offer', pin);
    expect(decoded.type).toBe('offer');
    expect(decoded.sdp).toBe('v=0\r\n...');
  });

  it('round-trips a valid answer description', async () => {
    const desc = { type: 'answer', sdp: 'a=...' } as RTCSessionDescription;
    const code = await encodeConnectionCode(desc, pin);
    const decoded = await decodeConnectionCode(code, 'answer', pin);
    expect(decoded.type).toBe('answer');
  });

  it('accepts any type when expectedType is undefined', async () => {
    const desc = { type: 'offer', sdp: 'v=0' } as RTCSessionDescription;
    const code = await encodeConnectionCode(desc, pin);
    const decoded = await decodeConnectionCode(code, undefined, pin);
    expect(decoded.type).toBe('offer');
  });

  it('throws when passphrase is wrong', async () => {
    const desc = { type: 'offer', sdp: 'v=0' } as RTCSessionDescription;
    const code = await encodeConnectionCode(desc, pin);
    await expect(decodeConnectionCode(code, 'offer', '9999')).rejects.toThrow(/could not decrypt/);
  });

  it('throws when expected type does not match', async () => {
    const desc = { type: 'offer', sdp: 'v=0' } as RTCSessionDescription;
    const code = await encodeConnectionCode(desc, pin);
    await expect(decodeConnectionCode(code, 'answer', pin)).rejects.toThrow(/expected answer/);
  });

  it('throws on malformed JSON inside the ciphertext', async () => {
    // Encrypt a non-JSON payload using the underlying crypto directly
    const { encryptPayload } = await import('./share-crypto.js');
    const code = await encryptPayload('not json {{{', pin);
    await expect(decodeConnectionCode(code, 'offer', pin)).rejects.toThrow(/malformed data/);
  });

  it('throws when required fields are missing', async () => {
    const { encryptPayload } = await import('./share-crypto.js');
    const code = await encryptPayload(JSON.stringify({ type: 'offer' }), pin);
    await expect(decodeConnectionCode(code, 'offer', pin)).rejects.toThrow(/missing required fields/);
  });

  it('throws when type is not offer or answer', async () => {
    const { encryptPayload } = await import('./share-crypto.js');
    const code = await encryptPayload(JSON.stringify({ type: 'bogus', sdp: 'v=0' }), pin);
    await expect(decodeConnectionCode(code, undefined, pin)).rejects.toThrow(/unexpected type/);
  });
});

describe('waitForIceGathering', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makePC(initialState: RTCIceGatheringState) {
    const listeners = new Map<string, () => void>();
    const pc: Partial<RTCPeerConnection> = {
      iceGatheringState: initialState,
      addEventListener: vi.fn((event: string, cb: () => void) => {
        listeners.set(event, cb);
      }) as unknown as RTCPeerConnection['addEventListener'],
      removeEventListener: vi.fn((event: string) => {
        listeners.delete(event);
      }) as unknown as RTCPeerConnection['removeEventListener'],
    };
    return { pc: pc as RTCPeerConnection, listeners };
  }

  it('resolves immediately if gathering is already complete', async () => {
    const { pc } = makePC('complete');
    await expect(waitForIceGathering(pc)).resolves.toBeUndefined();
  });

  it('resolves when the gathering state transitions to complete', async () => {
    const { pc, listeners } = makePC('gathering');
    const promise = waitForIceGathering(pc);
    // Simulate state change
    (pc as unknown as { iceGatheringState: RTCIceGatheringState }).iceGatheringState = 'complete';
    listeners.get('icegatheringstatechange')?.();
    await expect(promise).resolves.toBeUndefined();
  });

  it('resolves via the 10s timeout fallback if gathering stalls', async () => {
    const { pc } = makePC('gathering');
    const promise = waitForIceGathering(pc);
    vi.advanceTimersByTime(10_000);
    await expect(promise).resolves.toBeUndefined();
  });

  it('does not resolve on non-complete state change', async () => {
    const { pc, listeners } = makePC('new');
    let resolved = false;
    void waitForIceGathering(pc).then(() => {
      resolved = true;
    });
    // Fire a change event while still not complete
    listeners.get('icegatheringstatechange')?.();
    // Let microtasks flush
    await Promise.resolve();
    expect(resolved).toBe(false);
  });
});
