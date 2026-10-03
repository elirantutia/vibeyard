// Host-side WebRTC logic for P2P session sharing.
// Uses native RTCPeerConnection (available in Electron's Chromium).

import type { ShareMode, ShareMessage } from '../../shared/sharing-types.js';
import { getTerminalInstance } from '../components/terminal-pane.js';
import { SerializeAddon } from '@xterm/addon-serialize';
import { ICE_CONFIG, sendMessage, waitForIceGathering, encodeConnectionCode, decodeConnectionCode } from './webrtc-utils.js';
import { generateChallenge, computeChallengeResponse, bytesToHex, validateShareKey } from './share-crypto.js';

interface HostPeer {
  sessionId: string;
  mode: ShareMode;
  passphrase: string;
  pc: RTCPeerConnection;
  dc: RTCDataChannel;
  connected: boolean;
  authState: 'none' | 'pending' | 'verified';
  authChallenge: Uint8Array<ArrayBuffer> | null;
  authTimeout: ReturnType<typeof setTimeout> | null;
  keepaliveTimer: ReturnType<typeof setInterval> | null;
  missedPongs: number;
  serializeAddon: SerializeAddon;
  tornDown: boolean;
}

const hostPeers = new Map<string, HostPeer>();

const KEEPALIVE_INTERVAL = 30_000;
const MAX_MISSED_PONGS = 3;
const CHUNK_SIZE = 64 * 1024;
const AUTH_TIMEOUT = 10_000;

type EventCallback = () => void;

export interface ShareHandle {
  getOffer(): Promise<string>;
  acceptAnswer(answer: string): Promise<void>;
  stop(): void;
  onConnected(cb: EventCallback): void;
  onDisconnected(cb: EventCallback): void;
  onAuthFailed(cb: (reason: string) => void): void;
}

export function startShare(sessionId: string, mode: ShareMode, passphrase: string): ShareHandle {
  const keyError = validateShareKey(passphrase);
  if (keyError) throw new Error(keyError);
  stopShare(sessionId);

  const instance = getTerminalInstance(sessionId);
  if (!instance) throw new Error(`No terminal instance for session ${sessionId}`);

  const serializeAddon = new SerializeAddon();
  instance.terminal.loadAddon(serializeAddon);

  const connectedCbs: EventCallback[] = [];
  const disconnectedCbs: EventCallback[] = [];
  const authFailedCbs: ((reason: string) => void)[] = [];
  let disconnectFired = false;

  const pc = new RTCPeerConnection(ICE_CONFIG);
  const dc = pc.createDataChannel('terminal', { ordered: true });

  const hostPeer: HostPeer = {
    sessionId,
    mode,
    passphrase,
    pc,
    dc,
    connected: false,
    authState: 'none',
    authChallenge: null,
    authTimeout: null,
    keepaliveTimer: null,
    missedPongs: 0,
    serializeAddon,
    tornDown: false,
  };

  hostPeers.set(sessionId, hostPeer);

  const sendInitAndStartKeepalive = (): void => {
    const scrollback = serializeAddon.serialize();
    const { cols, rows } = instance.terminal;
    const sessionName = instance.sessionId;

    const initMsg: ShareMessage = {
      type: 'init',
      scrollback: '',
      mode,
      cols,
      rows,
      sessionName,
    };

    if (scrollback.length > CHUNK_SIZE) {
      sendMessage(dc, initMsg);
      for (let i = 0; i < scrollback.length; i += CHUNK_SIZE) {
        sendMessage(dc, { type: 'data', payload: scrollback.slice(i, i + CHUNK_SIZE) });
      }
    } else {
      initMsg.scrollback = scrollback;
      sendMessage(dc, initMsg);
    }

    hostPeer.keepaliveTimer = setInterval(() => {
      if (!hostPeer.connected) return;
      hostPeer.missedPongs++;
      if (hostPeer.missedPongs > MAX_MISSED_PONGS) {
        stopShare(sessionId);
        return;
      }
      sendMessage(dc, { type: 'ping' });
    }, KEEPALIVE_INTERVAL);

    for (const cb of connectedCbs) cb();
  }

  dc.onopen = () => {
    if (hostPeers.get(sessionId) !== hostPeer) return;
    // Start auth handshake — do not send session data until verified
    const challenge = generateChallenge();
    hostPeer.authChallenge = challenge;
    hostPeer.authState = 'pending';
    sendMessage(dc, { type: 'auth-challenge', challenge: bytesToHex(challenge) });

    hostPeer.authTimeout = setTimeout(() => {
      if (hostPeers.get(sessionId) === hostPeer && hostPeer.authState !== 'verified') {
        for (const cb of authFailedCbs) cb('Authentication timed out');
        stopShare(sessionId);
      }
    }, AUTH_TIMEOUT);
  };

  dc.onmessage = (event: MessageEvent) => {
    let msg: ShareMessage;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    // Auth handshake
    if (hostPeer.authState === 'pending' && msg.type === 'auth-response') {
      computeChallengeResponse(hostPeer.authChallenge!, passphrase).then((expected) => {
        if (hostPeers.get(sessionId) !== hostPeer || hostPeer.authState !== 'pending') return;
        if (hostPeer.authTimeout) {
          clearTimeout(hostPeer.authTimeout);
          hostPeer.authTimeout = null;
        }
        if (expected === msg.response) {
          hostPeer.authState = 'verified';
          hostPeer.connected = true;
          sendMessage(dc, { type: 'auth-result', ok: true });
          sendInitAndStartKeepalive();
        } else {
          sendMessage(dc, { type: 'auth-result', ok: false, reason: 'Passphrase mismatch' });
          for (const cb of authFailedCbs) cb('Passphrase mismatch');
          stopShare(sessionId);
        }
      });
      return;
    }

    // Ignore all non-auth messages until verified
    if (hostPeer.authState !== 'verified') return;

    if (msg.type === 'input' && mode === 'readwrite') {
      window.vibeyard.pty.write(sessionId, msg.payload);
    } else if (msg.type === 'pong') {
      hostPeer.missedPongs = 0;
    }
  };

  const handleDisconnect = () => {
    if (hostPeers.get(sessionId) !== hostPeer) return;
    if (disconnectFired) return;
    disconnectFired = true;
    hostPeer.connected = false;
    teardown(hostPeer);
    for (const cb of disconnectedCbs) cb();
  };

  dc.onclose = handleDisconnect;

  pc.oniceconnectionstatechange = () => {
    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
      handleDisconnect();
    }
  };

  return {
    async getOffer(): Promise<string> {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);
      return encodeConnectionCode(pc.localDescription, passphrase);
    },
    async acceptAnswer(answer: string): Promise<void> {
      const desc = await decodeConnectionCode(answer, 'answer', passphrase);
      await pc.setRemoteDescription(new RTCSessionDescription(desc));
    },
    stop(): void {
      stopShare(sessionId);
    },
    onConnected(cb: EventCallback): void {
      connectedCbs.push(cb);
    },
    onDisconnected(cb: EventCallback): void {
      disconnectedCbs.push(cb);
    },
    onAuthFailed(cb: (reason: string) => void): void {
      authFailedCbs.push(cb);
    },
  };
}

export function stopShare(sessionId: string): void {
  const hostPeer = hostPeers.get(sessionId);
  if (!hostPeer) return;

  if (hostPeer.connected) {
    try { sendMessage(hostPeer.dc, { type: 'end' }); } catch { /* ignore */ }
  }
  teardown(hostPeer);
}

export function broadcastData(sessionId: string, data: string): void {
  const hostPeer = hostPeers.get(sessionId);
  if (!hostPeer?.connected || hostPeer.authState !== 'verified') return;
  sendMessage(hostPeer.dc, { type: 'data', payload: data });
}

export function broadcastResize(sessionId: string, cols: number, rows: number): void {
  const hostPeer = hostPeers.get(sessionId);
  if (!hostPeer?.connected || hostPeer.authState !== 'verified') return;
  sendMessage(hostPeer.dc, { type: 'resize', cols, rows });
}

export function isSharing(sessionId: string): boolean {
  return hostPeers.has(sessionId);
}

export function isConnected(sessionId: string): boolean {
  return hostPeers.get(sessionId)?.connected ?? false;
}

export function getShareMode(sessionId: string): ShareMode | null {
  return hostPeers.get(sessionId)?.mode ?? null;
}

/**
 * Idempotent teardown for one specific peer instance. Closes both native
 * resources (data channel and peer connection) and releases ownership.
 *
 * Safe to call from any terminal path (ICE disconnect/failed, channel close,
 * auth failure/timeout, explicit stop, replacement). Handlers are detached
 * before the natives are closed so the resulting close events cannot
 * re-enter teardown. Ownership is only removed if this peer is still the
 * owner of its session id, so a late teardown of a replaced peer cannot
 * delete the replacement's map entry.
 */
function teardown(peer: HostPeer): void {
  if (peer.tornDown) return;
  peer.tornDown = true;

  // Detach handlers so native close events cannot re-enter teardown.
  peer.dc.onclose = null;
  peer.dc.onopen = null;
  peer.dc.onmessage = null;
  peer.pc.oniceconnectionstatechange = null;

  if (peer.keepaliveTimer) {
    clearInterval(peer.keepaliveTimer);
    peer.keepaliveTimer = null;
  }
  if (peer.authTimeout) {
    clearTimeout(peer.authTimeout);
    peer.authTimeout = null;
  }
  peer.serializeAddon.dispose();

  try { peer.dc.close(); } catch { /* ignore */ }
  try { peer.pc.close(); } catch { /* ignore */ }

  if (hostPeers.get(peer.sessionId) === peer) {
    hostPeers.delete(peer.sessionId);
  }
}

export function _resetForTesting(): void {
  for (const peer of [...hostPeers.values()]) {
    teardown(peer);
  }
  hostPeers.clear();
}
