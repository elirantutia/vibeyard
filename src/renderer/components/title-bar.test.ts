// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderTitleBar, initTitleBar } from './title-bar.js';
import { appState } from '../state.js';
import { isWin } from '../platform.js';
import { promptNewProject } from './sidebar.js';
import { quickNewSession } from './tab-bar/session-menu.js';
import { closeSessionWithConfirm } from '../session-close.js';
import { toggleInspector } from './session-inspector.js';
import { toggleDebugPanel } from './debug-panel.js';
import { hideTabContextMenu } from './tab-bar/menu.js';

// title-bar.ts pulls in a wide module graph (state, sidebar, session-menu, …)
// that grabs DOM nodes / sets up event wiring at import time. Mock those so we
// can exercise the DOM-building + menu logic in isolation. i18n / platform /
// the shared menu tracker stay real, so labels and open/close behaviour are
// integration-tested rather than stubbed.
const m = vi.hoisted(() => {
  const appStateMock = {
    preferences: { debugMode: false },
    activeProject: null as { id: string } | null,
    activeSession: null as { id: string } | null,
    toggleSwarm: vi.fn(),
  };
  return {
    appState: appStateMock,
    promptNewProject: vi.fn(),
    quickNewSession: vi.fn(),
    closeSessionWithConfirm: vi.fn(),
    toggleInspector: vi.fn(),
    toggleDebugPanel: vi.fn(),
    shortcutManager: {
      getKeys: (id: string) =>
        ({
          'new-project': 'Ctrl+Shift+P',
          'new-session-alt': 'Ctrl+Shift+N',
          'close-session': 'Ctrl+W',
          'toggle-split': 'Ctrl+\\',
          'toggle-inspector': 'Ctrl+Shift+I',
          'debug-panel': 'Ctrl+Shift+D',
        } as Record<string, string>)[id],
    },
    displayKeys: (acc: string) => acc,
  };
});

vi.mock('../state.js', () => ({ appState: m.appState }));
vi.mock('./sidebar.js', () => ({ promptNewProject: m.promptNewProject }));
vi.mock('./tab-bar/session-menu.js', () => ({ quickNewSession: m.quickNewSession }));
vi.mock('../session-close.js', () => ({ closeSessionWithConfirm: m.closeSessionWithConfirm }));
vi.mock('./session-inspector.js', () => ({ toggleInspector: m.toggleInspector }));
vi.mock('./debug-panel.js', () => ({ toggleDebugPanel: m.toggleDebugPanel }));
vi.mock('../shortcuts.js', () => ({
  shortcutManager: m.shortcutManager,
  displayKeys: m.displayKeys,
  SHORTCUT_DEFAULTS: [],
}));

function render(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'title-bar';
  document.body.appendChild(root);
  renderTitleBar(root);
  return root;
}

function buttons(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll('.titlebar-menu-btn')) as HTMLElement[];
}

/** Click a menu button and return its dropdown's `.tab-context-menu-item`s. */
function openItems(btn: HTMLElement): HTMLElement[] {
  btn.click();
  const menu = document.querySelector('.tab-context-menu') as HTMLElement | null;
  return Array.from(menu?.querySelectorAll('.tab-context-menu-item') ?? []) as HTMLElement[];
}

/** Label text of an item, skipping the trailing shortcut hint span. */
function itemLabel(item: HTMLElement): string {
  const label = item.querySelector(':scope > span:not(.shortcut-hint)');
  return label?.textContent ?? item.textContent ?? '';
}

describe('title-bar', () => {
  beforeEach(() => {
    appState.preferences.debugMode = false;
    appState.activeProject = null;
    appState.activeSession = null;
    document.body.innerHTML = '';
    vi.clearAllMocks();
    (window as any).vibeyard = {
      menu: {
        runEditAction: vi.fn(),
        quitApp: vi.fn(),
        toggleDevTools: vi.fn(),
        reloadMainWindow: vi.fn(),
      },
    };
  });

  afterEach(() => {
    hideTabContextMenu();
  });

  it('renders the brand and File/Edit/View buttons', () => {
    const root = render();
    expect(root.classList.contains('active')).toBe(true);
    const brand = root.querySelector('.titlebar-brand') as HTMLElement;
    expect(brand.textContent).toBe('Vibeyard');
    const btns = buttons(root);
    expect(btns.map((b) => b.textContent)).toEqual(['File', 'Edit', 'View']);
    expect(btns[0].getAttribute('aria-haspopup')).toBe('menu');
  });

  it('File menu lists actions and wires New Project / New Session', () => {
    const root = render();
    const items = openItems(buttons(root)[0]);
    expect(items.map(itemLabel)).toEqual(['New Project', 'New Session', 'Close Session', 'Quit']);

    items[0].click();
    expect(promptNewProject).toHaveBeenCalledTimes(1);

    const again = openItems(buttons(root)[0]);
    again[1].click();
    expect(quickNewSession).toHaveBeenCalledTimes(1);
  });

  it('Close Session only fires with an active project and session', () => {
    const root = render();
    const items = openItems(buttons(root)[0]);
    items[2].click();
    expect(closeSessionWithConfirm).not.toHaveBeenCalled();

    appState.activeProject = { id: 'p1' } as any;
    appState.activeSession = { id: 's1' } as any;
    const again = openItems(buttons(root)[0]);
    again[2].click();
    expect(closeSessionWithConfirm).toHaveBeenCalledWith('p1', 's1');
  });

  it('File > Quit calls quitApp', () => {
    const root = render();
    const items = openItems(buttons(root)[0]);
    items[3].click();
    expect((window as any).vibeyard.menu.quitApp).toHaveBeenCalledTimes(1);
  });

  it('File menu shows shortcut hints', () => {
    render();
    openItems(buttons(render())[0]);
    const hints = Array.from(
      document.querySelectorAll('.tab-context-menu .shortcut-hint'),
    ) as HTMLElement[];
    expect(hints.map((h) => h.textContent)).toEqual(['Ctrl+Shift+P', 'Ctrl+Shift+N', 'Ctrl+W']);
  });

  it('Edit menu dispatches webContents edit actions', async () => {
    const root = render();
    const items = openItems(buttons(root)[1]);
    expect(items.map(itemLabel)).toEqual(['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Delete', 'Select All']);

    items[0].click(); // Undo
    await Promise.resolve();
    expect((window as any).vibeyard.menu.runEditAction).toHaveBeenCalledWith('undo');

    const again = openItems(buttons(root)[1]);
    again[6].click(); // Select All
    await Promise.resolve();
    expect((window as any).vibeyard.menu.runEditAction).toHaveBeenLastCalledWith('selectAll');
  });

  it('View menu shows split and inspector, no debug items by default', () => {
    const root = render();
    const items = openItems(buttons(root)[2]);
    expect(items.map(itemLabel)).toEqual(['Toggle Split Mode', 'Toggle Session Inspector']);
  });

  it('View > Toggle Split / Toggle Inspector wire to appState / toggleInspector', () => {
    const root = render();
    const items = openItems(buttons(root)[2]);
    items[0].click();
    expect(appState.toggleSwarm).toHaveBeenCalledTimes(1);

    const again = openItems(buttons(root)[2]);
    again[1].click();
    expect(toggleInspector).toHaveBeenCalledTimes(1);
  });

  it('View menu adds debug items and wires them when debug mode is on', () => {
    appState.preferences.debugMode = true;
    const root = render();
    const items = openItems(buttons(root)[2]);
    expect(items.map(itemLabel)).toEqual([
      'Toggle Split Mode',
      'Toggle Session Inspector',
      'Toggle Debug Panel',
      'Toggle DevTools',
      'Reload Main Window',
    ]);

    items[2].click();
    expect(toggleDebugPanel).toHaveBeenCalledTimes(1);

    const again = openItems(buttons(root)[2]);
    again[3].click();
    expect((window as any).vibeyard.menu.toggleDevTools).toHaveBeenCalledTimes(1);

    const third = openItems(buttons(root)[2]);
    third[4].click();
    expect((window as any).vibeyard.menu.reloadMainWindow).toHaveBeenCalledTimes(1);
  });

  it('only one menu is open at a time and clicking the button toggles it', () => {
    const root = render();
    const btns = buttons(root);
    btns[0].click();
    btns[1].click();
    expect(document.querySelectorAll('.tab-context-menu')).toHaveLength(1);

    btns[1].click(); // toggle closed
    expect(document.querySelector('.tab-context-menu')).toBeNull();
  });

  it('initTitleBar leaves the bar inert on non-Windows platforms', () => {
    const bar = document.createElement('div');
    bar.id = 'title-bar';
    document.body.appendChild(bar);
    initTitleBar();
    if (!isWin) {
      expect(bar.classList.contains('active')).toBe(false);
      expect(bar.classList.contains('win')).toBe(false);
    }
  });

  it('CSS reserves a drag region and no-drag on the menu buttons', () => {
    const css = readFileSync(join(process.cwd(), 'src', 'renderer', 'styles', 'title-bar.css'), 'utf8');
    expect(css).toContain('-webkit-app-region: drag');
    expect(css).toContain('-webkit-app-region: no-drag');
  });
});
