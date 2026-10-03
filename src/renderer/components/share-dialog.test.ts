import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock peer-host before importing share-dialog
const mockIsSharing = vi.fn(() => false);
const mockIsConnected = vi.fn(() => false);
vi.mock('../sharing/peer-host.js', () => ({
  isSharing: (...args: unknown[]) => mockIsSharing(...args),
  isConnected: (...args: unknown[]) => mockIsConnected(...args),
}));

// Mock share-manager before importing share-dialog
const mockEndShare = vi.fn();
const mockShareSession = vi.fn();
vi.mock('../sharing/share-manager.js', () => ({
  shareSession: (...args: unknown[]) => mockShareSession(...args),
  acceptShareAnswer: vi.fn(),
  endShare: (...args: unknown[]) => mockEndShare(...args),
}));

// Mock share-crypto
vi.mock('../sharing/share-crypto.js', () => ({
  generateShareKey: () => '0123456789abcdef0123456789abcdef',
  DecryptionError: class DecryptionError extends Error {},
}));

// Minimal DOM stubs so share-dialog can create elements without jsdom
const elementStubs = new Map<string, Record<string, unknown>>();
function makeElement(): Record<string, unknown> {
  const el: Record<string, unknown> = {
    className: '',
    textContent: '',
    innerHTML: '',
    readOnly: false,
    rows: 0,
    placeholder: '',
    type: '',
    name: '',
    value: '',
    checked: false,
    disabled: false,
    _listeners: {} as Record<string, Function[]>,
    appendChild(child: Record<string, unknown>) { return child; },
    remove() {},
    classList: {
      add() {},
      remove() {},
    },
    addEventListener(event: string, cb: Function) {
      const listeners = (el._listeners as Record<string, Function[]>);
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    removeEventListener() {},
  };
  return el;
}

// Stub document and navigator
const createdElements: Record<string, unknown>[] = [];
vi.stubGlobal('document', {
  createElement(_tag: string) {
    const el = makeElement();
    createdElements.push(el);
    return el;
  },
  body: {
    appendChild(_child: unknown) {},
  },
  querySelector(_sel: string) {
    // Return a checked radio with value 'readonly'
    return { value: 'readonly' };
  },
  addEventListener() {},
  removeEventListener() {},
});

vi.stubGlobal('navigator', {
  clipboard: { writeText: vi.fn() },
});

import { showShareDialog, closeShareDialog } from './share-dialog.js';

beforeEach(() => {
  vi.clearAllMocks();
  createdElements.length = 0;
  // Reset module state by closing any lingering dialog
  closeShareDialog();
  vi.clearAllMocks();
});

function findButton(text: string): Record<string, unknown> | undefined {
  return createdElements.find(
    (el) => el.textContent === text && (el as HTMLElement).className !== undefined
  );
}

function clickButton(text: string): void {
  const btn = findButton(text);
  if (!btn) throw new Error(`Button "${text}" not found`);
  const listeners = (btn._listeners as Record<string, Function[]>);
  for (const cb of listeners['click'] ?? []) cb();
}

describe('share-dialog cleanup on close', () => {
  it('does not call endShare when dialog closed before starting share', () => {
    showShareDialog('session-1');
    closeShareDialog();
    expect(mockEndShare).not.toHaveBeenCalled();
  });

  it('calls endShare when dialog closed after starting share but before connection', async () => {
    let onConnectedCb: (() => void) | undefined;
    const mockHandle = {
      onConnected: (cb: () => void) => { onConnectedCb = cb; },
      onAuthFailed: () => {},
    };
    mockShareSession.mockResolvedValue({ offer: 'test-offer', handle: mockHandle });

    showShareDialog('session-1');
    clickButton('Start Sharing');

    await vi.waitFor(() => {
      expect(mockShareSession).toHaveBeenCalledWith('session-1', 'readonly', expect.any(String));
    });

    // Sharing is active but not connected
    mockIsSharing.mockReturnValue(true);
    mockIsConnected.mockReturnValue(false);

    closeShareDialog();
    expect(mockEndShare).toHaveBeenCalledWith('session-1');
  });

  it('does not call endShare when peer has connected', async () => {
    let onConnectedCb: (() => void) | undefined;
    const mockHandle = {
      onConnected: (cb: () => void) => { onConnectedCb = cb; },
      onAuthFailed: () => {},
    };
    mockShareSession.mockResolvedValue({ offer: 'test-offer', handle: mockHandle });

    showShareDialog('session-1');
    clickButton('Start Sharing');

    await vi.waitFor(() => {
      expect(mockShareSession).toHaveBeenCalled();
    });

    // Peer connected
    mockIsSharing.mockReturnValue(true);
    mockIsConnected.mockReturnValue(true);

    // Simulate onConnected triggering closeShareDialog
    onConnectedCb!();
    expect(mockEndShare).not.toHaveBeenCalled();
  });

  it('calls endShare when shareSession throws', async () => {
    mockShareSession.mockRejectedValue(new Error('WebRTC failed'));
    mockIsSharing.mockReturnValue(true);

    showShareDialog('session-1');
    clickButton('Start Sharing');

    await vi.waitFor(() => {
      expect(mockEndShare).toHaveBeenCalledWith('session-1');
    });
  });
});
