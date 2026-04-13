// Stub document for non-browser test environment
vi.stubGlobal('document', {
  hidden: false,
  addEventListener: vi.fn(),
});

const { mockAppState, appStateListeners } = vi.hoisted(() => {
  const listeners = new Map<string, Array<() => void>>();
  return {
    appStateListeners: listeners,
    mockAppState: {
      discussionsLastSeen: undefined as string | undefined,
      setDiscussionsLastSeen: vi.fn((ts: string) => { mockAppState.discussionsLastSeen = ts; }),
      on: vi.fn((event: string, cb: () => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(cb);
      }),
    },
  };
});

vi.mock('./state', () => ({ appState: mockAppState }));

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);
vi.stubGlobal('DOMParser', class {
  parseFromString(text: string, _type: string) {
    // Minimal XML parsing for tests — extract <entry><updated> values
    const entries: Array<{ querySelector: (sel: string) => { textContent: string } | null }> = [];
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    while ((match = entryRegex.exec(text)) !== null) {
      const content = match[1];
      const updatedMatch = /<updated>(.*?)<\/updated>/.exec(content);
      entries.push({
        querySelector: (sel: string) => {
          if (sel === 'updated' && updatedMatch) return { textContent: updatedMatch[1] };
          return null;
        },
      });
    }
    return {
      querySelectorAll: (sel: string) => sel === 'entry' ? entries : [],
    };
  }
});

import {
  init,
  getNewCount,
  markSeen,
  onChange,
  _resetForTesting,
} from './discussions-badge';

function buildAtomFeed(timestamps: string[]): string {
  const entries = timestamps.map(t => `<entry><updated>${t}</updated></entry>`).join('');
  return `<?xml version="1.0"?><feed>${entries}</feed>`;
}

beforeEach(() => {
  _resetForTesting();
  mockAppState.discussionsLastSeen = undefined;
  mockAppState.setDiscussionsLastSeen.mockClear();
  mockAppState.on.mockReset();
  appStateListeners.clear();
  mockFetch.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('discussions-badge', () => {
  it('starts with count 0', () => {
    expect(getNewCount()).toBe(0);
  });

  it('counts all entries as new when no lastSeen is set', async () => {
    const feed = buildAtomFeed(['2026-04-12T10:00:00Z', '2026-04-11T09:00:00Z']);
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feed) });

    init();
    // Fire state-loaded to trigger poll
    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);

    expect(getNewCount()).toBe(2);
  });

  it('counts only entries newer than lastSeen', async () => {
    mockAppState.discussionsLastSeen = '2026-04-11T12:00:00Z';
    const feed = buildAtomFeed([
      '2026-04-12T10:00:00Z',
      '2026-04-11T09:00:00Z',
      '2026-04-10T08:00:00Z',
    ]);
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feed) });

    init();
    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);

    expect(getNewCount()).toBe(1);
  });

  it('markSeen resets count and persists latest timestamp', async () => {
    const feed = buildAtomFeed(['2026-04-12T10:00:00Z', '2026-04-11T09:00:00Z']);
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feed) });

    init();
    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);
    expect(getNewCount()).toBe(2);

    markSeen();
    expect(getNewCount()).toBe(0);
    expect(mockAppState.setDiscussionsLastSeen).toHaveBeenCalledWith('2026-04-12T10:00:00Z');
  });

  it('notifies listeners on poll', async () => {
    const feed = buildAtomFeed(['2026-04-12T10:00:00Z']);
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feed) });

    init();
    const cb = vi.fn();
    onChange(cb);
    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);

    expect(cb).toHaveBeenCalled();
  });

  it('notifies listeners on markSeen', async () => {
    const feed = buildAtomFeed(['2026-04-12T10:00:00Z']);
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feed) });

    init();
    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);

    const cb = vi.fn();
    onChange(cb);
    markSeen();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', async () => {
    const feed = buildAtomFeed(['2026-04-12T10:00:00Z']);
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve(feed) });

    init();
    const cb = vi.fn();
    const unsub = onChange(cb);
    unsub();

    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);

    expect(cb).not.toHaveBeenCalled();
  });

  it('silently handles fetch errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network error'));

    init();
    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);

    expect(getNewCount()).toBe(0);
  });

  it('silently handles non-ok responses', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    init();
    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);

    expect(getNewCount()).toBe(0);
  });

  it('handles empty feed gracefully', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('<feed></feed>') });

    init();
    for (const cb of appStateListeners.get('state-loaded') ?? []) cb();
    await vi.advanceTimersByTimeAsync(0);

    expect(getNewCount()).toBe(0);
  });
});
