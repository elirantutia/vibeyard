// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChange } from '../../shared/types';

vi.mock('../state.js', () => ({
  appState: { addFileReaderSession: vi.fn(), addBrowserTabSession: vi.fn() },
}));
vi.mock('./modal.js', () => ({ showConfirmModal: vi.fn(), showPropertiesDialog: vi.fn() }));
vi.mock('./board/board-context-menu.js', () => ({ showContextMenu: vi.fn() }));
vi.mock('../file-url.js', () => ({ pathToFileURL: (p: string) => `file://${p}` }));

import { renderFileTree, _resetForTesting, DirEntry, isExpanded } from './file-tree.js';

// --- Fake filesystem backing window.vibeyard.fs ---
let dirContents: Map<string, DirEntry[]>;
let fsChangeCb: ((changes: FsChange[]) => void) | null = null;
const watchedDirs = new Set<string>();

function entry(name: string, dir: string, isDirectory: boolean): DirEntry {
  return { name, path: `${dir}/${name}`, isDirectory };
}

beforeEach(() => {
  _resetForTesting();
  dirContents = new Map();
  fsChangeCb = null;
  watchedDirs.clear();
  (globalThis as any).window = globalThis;
  (globalThis as any).vibeyard = {
    fs: {
      listDir: vi.fn((dir: string) => Promise.resolve(dirContents.get(dir) ?? [])),
      watchDir: vi.fn((dir: string) => { watchedDirs.add(dir); }),
      unwatchDir: vi.fn((dir: string) => { watchedDirs.delete(dir); }),
      onFsChange: vi.fn((cb: (c: FsChange[]) => void) => { fsChangeCb = cb; return () => { fsChangeCb = null; }; }),
    },
  };
});

// Resolve microtasks (listDir promises) and drain queued rAF callbacks until the
// reconcile pipeline (async loadEntries + DOM patch) has fully settled.
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await Promise.resolve();
    const cbs: FrameRequestCallback[] = (globalThis as any).__rafQueue ?? [];
    (globalThis as any).__rafQueue = [];
    for (const cb of cbs) cb(0);
    await Promise.resolve();
  }
}

// jsdom provides rAF, but we want deterministic control — stub it into a queue.
(globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
  ((globalThis as any).__rafQueue ??= []).push(cb);
  return 1;
};

// jsdom does not implement CSS.escape.
if (!(globalThis as any).CSS) (globalThis as any).CSS = { escape: (s: string) => s };

function rows(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.file-tree-row'))
    .map((r) => (r as HTMLElement).dataset.entryPath!)
    .filter(Boolean);
}

function emit(changes: FsChange[]): void {
  fsChangeCb?.(changes);
}

describe('file tree reconciliation', () => {
  it('adds a new file at the correct sorted position without rebuilding', async () => {
    dirContents.set('/proj', [entry('a.ts', '/proj', false), entry('c.ts', '/proj', false)]);
    const container = document.createElement('div');
    renderFileTree({ id: 'p1', path: '/proj' } as any, container);
    await settle();
    expect(rows(container)).toEqual(['/proj/a.ts', '/proj/c.ts']);

    // Capture the existing 'a.ts' node — it must survive the reconcile (identity preserved).
    const aNode = container.querySelector('[data-entry-path="/proj/a.ts"]');

    dirContents.set('/proj', [
      entry('a.ts', '/proj', false),
      entry('b.ts', '/proj', false),
      entry('c.ts', '/proj', false),
    ]);
    emit([{ path: '/proj/b.ts', dir: '/proj', type: 'add' }]);
    await settle();

    expect(rows(container)).toEqual(['/proj/a.ts', '/proj/b.ts', '/proj/c.ts']);
    expect(container.querySelector('[data-entry-path="/proj/a.ts"]')).toBe(aNode);
  });

  it('inserts many new files at once in correct sorted order', async () => {
    dirContents.set('/proj', [entry('a.ts', '/proj', false), entry('z.ts', '/proj', false)]);
    const container = document.createElement('div');
    renderFileTree({ id: 'p1', path: '/proj' } as any, container);
    await settle();

    const next = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'z.ts'].map((n) => entry(n, '/proj', false));
    dirContents.set('/proj', next);
    emit(next.slice(1, 5).map((e) => ({ path: e.path, dir: '/proj', type: 'add' as const })));
    await settle();

    expect(rows(container)).toEqual([
      '/proj/a.ts', '/proj/b.ts', '/proj/c.ts', '/proj/d.ts', '/proj/e.ts', '/proj/z.ts',
    ]);
  });

  it('removes a deleted entry', async () => {
    dirContents.set('/proj', [entry('a.ts', '/proj', false), entry('b.ts', '/proj', false)]);
    const container = document.createElement('div');
    renderFileTree({ id: 'p1', path: '/proj' } as any, container);
    await settle();

    dirContents.set('/proj', [entry('a.ts', '/proj', false)]);
    emit([{ path: '/proj/b.ts', dir: '/proj', type: 'unlink' }]);
    await settle();

    expect(rows(container)).toEqual(['/proj/a.ts']);
  });

  it('preserves an expanded subtree when a sibling changes', async () => {
    dirContents.set('/proj', [entry('src', '/proj', true), entry('z.ts', '/proj', false)]);
    dirContents.set('/proj/src', [entry('deep.ts', '/proj/src', false)]);
    const container = document.createElement('div');
    renderFileTree({ id: 'p1', path: '/proj' } as any, container);
    await settle();

    // Expand /proj/src (the click handler toggles + renders).
    const srcRow = container.querySelector('[data-entry-path="/proj/src"]') as HTMLElement;
    srcRow.dispatchEvent(new Event('click'));
    await settle();
    expect(isExpanded('p1', '/proj/src')).toBe(true);
    expect(rows(container)).toContain('/proj/src/deep.ts');

    // A new sibling file appears at the root.
    dirContents.set('/proj', [
      entry('src', '/proj', true),
      entry('y.ts', '/proj', false),
      entry('z.ts', '/proj', false),
    ]);
    emit([{ path: '/proj/y.ts', dir: '/proj', type: 'add' }]);
    await settle();

    // The expanded subtree's deep child is still present (subtree was not rebuilt).
    expect(rows(container)).toContain('/proj/src/deep.ts');
    expect(rows(container)).toContain('/proj/y.ts');
  });

  it('unwatches a removed directory subtree', async () => {
    dirContents.set('/proj', [entry('src', '/proj', true)]);
    dirContents.set('/proj/src', [entry('deep.ts', '/proj/src', false)]);
    const container = document.createElement('div');
    renderFileTree({ id: 'p1', path: '/proj' } as any, container);
    await settle();
    const srcRow = container.querySelector('[data-entry-path="/proj/src"]') as HTMLElement;
    srcRow.dispatchEvent(new Event('click'));
    await settle();
    expect(watchedDirs.has('/proj/src')).toBe(true);

    // Delete /proj/src
    dirContents.set('/proj', []);
    emit([{ path: '/proj/src', dir: '/proj', type: 'unlinkDir' }]);
    await settle();

    expect(rows(container)).toEqual([]);
    expect(watchedDirs.has('/proj/src')).toBe(false);
    expect(isExpanded('p1', '/proj/src')).toBe(false);
  });
});
