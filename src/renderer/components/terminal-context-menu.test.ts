// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showTerminalContextMenu, hideTerminalContextMenu } from './terminal-context-menu.js';

function makeMockTerminal(hasSelection = false, selection = '') {
  return {
    hasSelection: vi.fn(() => hasSelection),
    getSelection: vi.fn(() => selection),
    selectAll: vi.fn(),
    focus: vi.fn(),
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

  it('renders menu with three items', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const menu = document.querySelector('.tab-context-menu') as HTMLElement;
    expect(menu).toBeTruthy();

    const items = menu.querySelectorAll('.tab-context-menu-item');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Copy');
    expect(items[1].textContent).toContain('Paste');
    expect(items[2].textContent).toContain('Select All');
  });

  it('positions menu at given coordinates', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(200, 300, terminal, writeToPty);

    const menu = document.querySelector('.tab-context-menu') as HTMLElement;
    expect(menu.style.left).toBe('200px');
    expect(menu.style.top).toBe('300px');
  });

  it('disables Copy when no selection', () => {
    const terminal = makeMockTerminal(false);
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    expect(items[0].classList.contains('disabled')).toBe(true);
  });

  it('enables Copy when selection exists', () => {
    const terminal = makeMockTerminal(true, 'selected text');
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    expect(items[0].classList.contains('disabled')).toBe(false);
  });

  it('hideTerminalContextMenu removes menu from DOM', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);
    expect(document.querySelector('.tab-context-menu')).toBeTruthy();

    hideTerminalContextMenu();
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('calling show twice replaces the first menu', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);
    showTerminalContextMenu(200, 200, terminal, writeToPty);

    const menus = document.querySelectorAll('.tab-context-menu');
    expect(menus).toHaveLength(1);
    expect((menus[0] as HTMLElement).style.left).toBe('200px');
  });

  it('Escape key dismisses the menu', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);
    expect(document.querySelector('.tab-context-menu')).toBeTruthy();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('click outside dismisses the menu', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);
    expect(document.querySelector('.tab-context-menu')).toBeTruthy();

    document.dispatchEvent(new MouseEvent('click'));
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('Select All calls terminal.selectAll()', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    (items[2] as HTMLElement).click();
    expect(terminal.selectAll).toHaveBeenCalled();
  });

  it('Copy click writes selection to clipboard', () => {
    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: mockWriteText, readText: vi.fn() } });

    const terminal = makeMockTerminal(true, 'hello world');
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    (items[0] as HTMLElement).click();

    expect(mockWriteText).toHaveBeenCalledWith('hello world');
  });

  it('Paste click reads clipboard and writes to PTY', async () => {
    const mockReadText = vi.fn().mockResolvedValue('pasted text');
    Object.assign(navigator, { clipboard: { writeText: vi.fn(), readText: mockReadText } });

    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    (items[1] as HTMLElement).click();

    expect(mockReadText).toHaveBeenCalled();
    // Wait for the promise to resolve
    await vi.waitFor(() => {
      expect(writeToPty).toHaveBeenCalledWith('pasted text');
    });
  });

  it('restores focus to the terminal after an action', () => {
    const terminal = makeMockTerminal();
    showTerminalContextMenu(100, 100, terminal, writeToPty);

    const items = document.querySelectorAll('.tab-context-menu-item');
    (items[1] as HTMLElement).click(); // Paste
    expect(terminal.focus).toHaveBeenCalled();
  });
});
