import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// A fake chokidar FSWatcher that records add/unwatch calls and lets tests emit events.
class FakeWatcher {
  added: string[] = [];
  unwatched: string[] = [];
  closed = false;
  handlers = new Map<string, (p: string) => void>();
  on(event: string, cb: (p: string) => void) {
    this.handlers.set(event, cb);
    return this;
  }
  add(p: string) { this.added.push(p); return this; }
  unwatch(p: string) { this.unwatched.push(p); return this; }
  close() { this.closed = true; return Promise.resolve(); }
  emit(event: string, p: string) { this.handlers.get(event)?.(p); }
}

let lastWatcher: FakeWatcher;
const FSWatcherCtor = vi.fn(() => {
  lastWatcher = new FakeWatcher();
  return lastWatcher;
});

vi.mock('chokidar', () => ({
  FSWatcher: function () { return FSWatcherCtor(); },
}));

import { watchDir, unwatchDir, setFileWatcherWindow, stopAllFileWatchers } from './file-watcher';

function makeWin() {
  const send = vi.fn();
  const win = { isDestroyed: () => false, webContents: { send } } as any;
  return { win, send };
}

beforeEach(() => {
  vi.useFakeTimers();
  FSWatcherCtor.mockClear();
  stopAllFileWatchers();
});

afterEach(() => {
  stopAllFileWatchers();
  vi.useRealTimers();
});

describe('directory ref-counting', () => {
  it('creates a single watcher and adds a dir once across multiple watchers', () => {
    watchDir('/a');
    watchDir('/a');
    expect(FSWatcherCtor).toHaveBeenCalledTimes(1);
    expect(lastWatcher.added).toEqual(['/a']);
  });

  it('only unwatches when the last reference is dropped', () => {
    watchDir('/a');
    watchDir('/a');
    unwatchDir('/a');
    expect(lastWatcher.unwatched).toEqual([]);
    unwatchDir('/a');
    expect(lastWatcher.unwatched).toEqual(['/a']);
  });

  it('ignores unwatch of an unknown dir', () => {
    watchDir('/a');
    unwatchDir('/never-watched');
    expect(lastWatcher.unwatched).toEqual([]);
  });
});

describe('change batching', () => {
  it('coalesces a burst into one debounced fs:changed send', () => {
    const { win, send } = makeWin();
    setFileWatcherWindow(win);
    watchDir('/a');

    lastWatcher.emit('add', '/a/one.ts');
    lastWatcher.emit('change', '/a/one.ts');
    lastWatcher.emit('unlink', '/a/two.ts');

    expect(send).not.toHaveBeenCalled(); // debounced
    vi.advanceTimersByTime(200);

    expect(send).toHaveBeenCalledTimes(1);
    const [channel, changes] = send.mock.calls[0];
    expect(channel).toBe('fs:changed');
    expect(changes).toEqual([
      { path: '/a/one.ts', dir: '/a', type: 'add' },
      { path: '/a/one.ts', dir: '/a', type: 'change' },
      { path: '/a/two.ts', dir: '/a', type: 'unlink' },
    ]);
  });

  it('does not send to a destroyed window', () => {
    const send = vi.fn();
    const win = { isDestroyed: () => true, webContents: { send } } as any;
    setFileWatcherWindow(win);
    watchDir('/a');
    lastWatcher.emit('change', '/a/x.ts');
    vi.advanceTimersByTime(200);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('teardown', () => {
  it('closes the watcher and clears state', () => {
    watchDir('/a');
    const w = lastWatcher;
    stopAllFileWatchers();
    expect(w.closed).toBe(true);

    // A subsequent watch spins up a fresh watcher.
    watchDir('/b');
    expect(FSWatcherCtor).toHaveBeenCalledTimes(2);
  });
});
