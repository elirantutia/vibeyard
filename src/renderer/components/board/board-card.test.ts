import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

// Mock DOM before importing board-card
vi.stubGlobal('document', {
  createElement: vi.fn(),
  getElementById: vi.fn(() => ({ textContent: '' })),
});

// Mock dependent modules
vi.mock('../../state', () => ({
  appState: {},
}));
vi.mock('../../board-state', () => ({
  getColumnByBehavior: vi.fn(),
  updateTask: vi.fn(),
  moveTask: vi.fn(),
  deleteTask: vi.fn(),
  getTagColor: vi.fn(),
}));
vi.mock('../../session-activity', () => ({
  getStatus: vi.fn(),
}));
vi.mock('./board-task-modal', () => ({
  showTaskModal: vi.fn(),
}));
vi.mock('./board-context-menu', () => ({
  showContextMenu: vi.fn(),
}));
vi.mock('../modal', () => ({
  showConfirmModal: vi.fn(),
}));
vi.mock('../terminal-pane', () => ({
  setPendingPrompt: vi.fn(),
}));

import { shortenPath } from './board-card';

describe('shortenPath', () => {
  it('abbreviates macOS home dirs', () => {
    expect(shortenPath('/Users/alice/projects/foo')).toBe('~/projects/foo');
  });

  it('abbreviates Linux home dirs', () => {
    expect(shortenPath('/home/alice/projects/foo')).toBe('~/projects/foo');
  });

  it('abbreviates Windows home dirs', () => {
    expect(shortenPath('C:\\Users\\alice\\projects\\foo')).toBe('~\\projects\\foo');
  });

  it('shortens long paths', () => {
    expect(shortenPath('/home/alice/a/b/c/d')).toBe('~/.../c/d');
  });

  it('returns empty string for empty input', () => {
    expect(shortenPath('')).toBe('');
  });
});
