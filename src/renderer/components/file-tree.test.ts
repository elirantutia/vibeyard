import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../state.js', () => ({
  appState: {
    addFileReaderSession: vi.fn(),
  },
}));

vi.mock('./modal.js', () => ({
  showConfirmModal: vi.fn(),
}));

vi.mock('./board/board-context-menu.js', () => ({
  showContextMenu: vi.fn(),
}));

import {
  sortEntries,
  toggleFolder,
  isExpanded,
  clearProjectState,
  _resetForTesting,
  DirEntry,
} from './file-tree.js';

describe('sortEntries', () => {
  it('puts directories before files', () => {
    const entries: DirEntry[] = [
      { name: 'zfile.txt', path: '/zfile.txt', isDirectory: false },
      { name: 'adir', path: '/adir', isDirectory: true },
    ];
    const sorted = sortEntries(entries);
    expect(sorted[0].name).toBe('adir');
    expect(sorted[1].name).toBe('zfile.txt');
  });

  it('sorts case-insensitively within the same kind', () => {
    const entries: DirEntry[] = [
      { name: 'Zebra', path: '/Zebra', isDirectory: true },
      { name: 'apple', path: '/apple', isDirectory: true },
      { name: 'Banana', path: '/Banana', isDirectory: true },
    ];
    const sorted = sortEntries(entries);
    expect(sorted.map(e => e.name)).toEqual(['apple', 'Banana', 'Zebra']);
  });

  it('does not mutate the input array', () => {
    const entries: DirEntry[] = [
      { name: 'b.ts', path: '/b.ts', isDirectory: false },
      { name: 'a.ts', path: '/a.ts', isDirectory: false },
    ];
    const original = [...entries];
    sortEntries(entries);
    expect(entries).toEqual(original);
  });
});

describe('expand state', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('toggleFolder flips state and returns new state', () => {
    expect(isExpanded('p1', '/src')).toBe(false);
    expect(toggleFolder('p1', '/src')).toBe(true);
    expect(isExpanded('p1', '/src')).toBe(true);
    expect(toggleFolder('p1', '/src')).toBe(false);
    expect(isExpanded('p1', '/src')).toBe(false);
  });

  it('keeps state isolated per project', () => {
    toggleFolder('p1', '/src');
    expect(isExpanded('p1', '/src')).toBe(true);
    expect(isExpanded('p2', '/src')).toBe(false);
  });

  it('clearProjectState removes only that project', () => {
    toggleFolder('p1', '/src');
    toggleFolder('p2', '/src');
    clearProjectState('p1');
    expect(isExpanded('p1', '/src')).toBe(false);
    expect(isExpanded('p2', '/src')).toBe(true);
  });
});
