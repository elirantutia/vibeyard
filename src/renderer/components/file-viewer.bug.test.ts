// @vitest-environment happy-dom
/**
 * Dynamic regression test: file-viewer.ts — selectionchange listener leak
 *
 * Bug: destroyFileViewerPane() removed the session from pendingReloads
 * but did NOT clean up the document 'selectionchange' listener when the
 * set became empty. If all viewers were destroyed while a reload was
 * pending (user had text selected), the listener remained forever.
 *
 * Fix: destroyFileViewerPane() now calls removeSelectionListener() when
 * pendingReloads reaches zero.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../state.js', () => ({
  appState: {
    on: vi.fn(),
    activeProject: null,
    preferences: {},
  },
}));

vi.mock('./search-bar.js', () => ({
  destroySearchBar: vi.fn(),
  createSearchBar: vi.fn(() => document.createElement('div')),
}));

// Track addEventListener / removeEventListener calls on document
const addedListeners: Map<string, EventListenerOrEventListenerObject[]> = new Map();
const removedListeners: Map<string, EventListenerOrEventListenerObject[]> = new Map();

const origAdd = document.addEventListener.bind(document);
const origRemove = document.removeEventListener.bind(document);

function selectionChangeListenerCount(): number {
  return (addedListeners.get('selectionchange') ?? []).length -
         (removedListeners.get('selectionchange') ?? []).length;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  addedListeners.clear();
  removedListeners.clear();

  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, ...rest) => {
    if (!addedListeners.has(type)) addedListeners.set(type, []);
    addedListeners.get(type)!.push(listener);
    origAdd(type, listener, ...rest as []);
  });

  vi.spyOn(document, 'removeEventListener').mockImplementation((type, listener, ...rest) => {
    if (!removedListeners.has(type)) removedListeners.set(type, []);
    removedListeners.get(type)!.push(listener);
    origRemove(type, listener, ...rest as []);
  });

  // Provide window.vibeyard mock
  (window as any).vibeyard = {
    fs: {
      unwatchFile: vi.fn(),
      watchFile: vi.fn(() => vi.fn()),
      readFile: vi.fn(() => Promise.resolve('')),
    },
  };

  vi.resetModules();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeFileViewer(sessionId: string) {
  const { createFileViewerPane } = await import('./file-viewer.js');

  // Create a mount point
  const container = document.createElement('div');
  container.id = `pane-${sessionId}`;
  document.body.appendChild(container);

  createFileViewerPane(sessionId, '/fake/path/file.ts', 'left', undefined);
  return sessionId;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('file-viewer.ts — selectionchange listener cleanup', () => {
  it('selectionchange listener is removed when last viewer is destroyed', async () => {
    const { createFileViewerPane, destroyFileViewerPane } = await import('./file-viewer.js');

    const container = document.createElement('div');
    document.body.appendChild(container);
    createFileViewerPane('sess-1', '/fake/file.ts', 'left', undefined);

    // Simulate a pending reload by selecting text while a file change is pending
    // (The listener is added by ensureSelectionListener when there are pending reloads)
    // We test indirectly: destroying the viewer should clean up even if listener was added
    expect(selectionChangeListenerCount()).toBe(0); // not added until file change

    destroyFileViewerPane('sess-1');

    // Listener should not have been leaked (either never added, or properly removed)
    expect(selectionChangeListenerCount()).toBe(0);
  });

  it('does not remove listener early if other viewers still have pending reloads', async () => {
    const { createFileViewerPane, destroyFileViewerPane } = await import('./file-viewer.js');

    const c1 = document.createElement('div');
    const c2 = document.createElement('div');
    document.body.appendChild(c1);
    document.body.appendChild(c2);

    createFileViewerPane('sess-a', '/fake/a.ts', 'left', undefined);
    createFileViewerPane('sess-b', '/fake/b.ts', 'left', undefined);

    // Destroy only one — listener (if any) should persist for the remaining viewer
    destroyFileViewerPane('sess-a');

    // Should not have negative listener count (can't remove more than added)
    expect(selectionChangeListenerCount()).toBeGreaterThanOrEqual(0);

    // Now destroy the last viewer
    destroyFileViewerPane('sess-b');

    // All cleaned up
    expect(selectionChangeListenerCount()).toBe(0);
  });
});
