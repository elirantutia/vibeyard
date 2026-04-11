// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showTerminalContextMenu, hideTerminalContextMenu } from './terminal-context-menu.js';

function makeMockTerminal(hasSelection = false, selection = '') {
  return {
    hasSelection: vi.fn(() => hasSelection),
    getSelection: vi.fn(() => selection),
    selectAll: vi.fn(),
    clear: vi.fn(),
  } as any;
}

describe('terminal-context-menu', () => {
  let writeToPty: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    writeToPty = vi.fn();
  });

  afterEach(() => {
    hideTerminalContextMenu();
  });

  it('renders menu with four items', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const menu = document.querySelector('.tab-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();

    const items = menu.querySelectorAll('.tab-context-menu-item');
    expect(items).toHaveLength(4);
    expect(items[0].textContent).toContain('Copy');
    expect(items[1].textContent).toContain('Paste');
    expect(items[2].textContent).toContain('Select All');
    expect(items[3].textContent).toContain('Clear Terminal');
  });

  it('positions menu at given coordinates', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(200, 300, terminal, writeToPty);

    const menu = document.querySelector('.tab-context-menu') as HTMLElement;
    expect(menu.style.left).toBe('200px');
    expect(menu.style.top).toBe('300px');
  });
});
