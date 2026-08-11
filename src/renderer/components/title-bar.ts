// Custom in-app title bar (Windows only). Hides the native white title bar
// and replaces it with a dark nav bar that matches the toolbar below:
// brand + File/Edit/View dropdown menus, reusing the existing tab-context-menu
// infrastructure (single open menu, click-outside / Escape dismissal).

import { appState } from '../state.js';
import { t } from '../i18n.js';
import { isWin } from '../platform.js';
import { promptNewProject } from './sidebar.js';
import { quickNewSession } from './tab-bar/session-menu.js';
import { closeSessionWithConfirm } from '../session-close.js';
import { toggleInspector } from './session-inspector.js';
import { toggleDebugPanel } from './debug-panel.js';
import { shortcutManager, displayKeys } from '../shortcuts.js';
import { getActiveContextMenu, hideTabContextMenu, setActiveContextMenu, positionMenu } from './tab-bar/menu.js';
import type { EditAction } from '../../shared/types.js';

// The menu button whose dropdown is currently open (drives the .open state).
let openButton: HTMLElement | null = null;

function clearOpenButton(): void {
  openButton?.classList.remove('open');
  openButton = null;
}

export function initTitleBar(): void {
  // macOS keeps the native title bar + system menu bar; Linux keeps the
  // native menu bar. Only Windows gets the custom in-app nav bar.
  if (!isWin) return;
  const bar = document.getElementById('title-bar');
  if (!bar) return;
  bar.classList.add('win');
  renderTitleBar(bar);
  // Clear the button's .open state when its dropdown is dismissed by a
  // click elsewhere or Escape (the menu element itself is removed by the
  // shared hideTabContextMenu wired in initTabBar).
  document.addEventListener('click', clearOpenButton);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') clearOpenButton();
  });
}

export function renderTitleBar(root: HTMLElement): void {
  root.classList.add('active');
  root.innerHTML = '';

  const brand = document.createElement('span');
  brand.className = 'titlebar-brand';
  brand.textContent = t('titleBar.brand');
  root.appendChild(brand);

  root.appendChild(buildMenuButton('file', buildFileMenu));
  root.appendChild(buildMenuButton('edit', buildEditMenu));
  root.appendChild(buildMenuButton('view', buildViewMenu));
}

function buildMenuButton(key: 'file' | 'edit' | 'view', buildMenu: () => HTMLElement): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'titlebar-menu-btn';
  btn.textContent = t(`titleBar.${key}.label`);
  btn.setAttribute('aria-haspopup', 'menu');
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); // don't let the document-level click-outside handler close it
    if (getActiveContextMenu() && openButton === btn) {
      hideTabContextMenu();
      clearOpenButton();
      return;
    }
    hideTabContextMenu();
    clearOpenButton();
    const menu = buildMenu();
    const rect = btn.getBoundingClientRect();
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 4}px`;
    document.body.appendChild(menu);
    setActiveContextMenu(menu);
    btn.classList.add('open');
    openButton = btn;
    positionMenu(menu);
  });
  return btn;
}

function addItem(menu: HTMLElement, label: string, onClick: () => void, shortcut?: string): void {
  const item = document.createElement('div');
  item.className = 'tab-context-menu-item';
  if (shortcut) {
    const labelEl = document.createElement('span');
    labelEl.textContent = label;
    const hint = document.createElement('span');
    hint.className = 'shortcut-hint';
    hint.textContent = shortcut;
    item.append(labelEl, hint);
  } else {
    item.textContent = label;
  }
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    clearOpenButton();
    onClick();
  });
  menu.appendChild(item);
}

function addSeparator(menu: HTMLElement): void {
  const sep = document.createElement('div');
  sep.className = 'tab-context-menu-separator';
  menu.appendChild(sep);
}

function makeMenu(): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'tab-context-menu titlebar-menu';
  return menu;
}

/** Platform-correct shortcut glyphs for a shortcut id, if any. */
function keysFor(id: string): string {
  const keys = shortcutManager.getKeys(id);
  return keys ? displayKeys(keys) : '';
}

function buildFileMenu(): HTMLElement {
  const menu = makeMenu();
  addItem(menu, t('titleBar.file.newProject'), promptNewProject, keysFor('new-project'));
  // Match the native menu's accelerator display (Ctrl+Shift+N).
  addItem(menu, t('titleBar.file.newSession'), quickNewSession, keysFor('new-session-alt'));
  addSeparator(menu);
  addItem(menu, t('titleBar.file.closeSession'), () => {
    const project = appState.activeProject;
    const session = appState.activeSession;
    if (project && session) closeSessionWithConfirm(project.id, session.id);
  }, keysFor('close-session'));
  addSeparator(menu);
  addItem(menu, t('titleBar.file.quit'), () => void window.vibeyard.menu.quitApp());
  return menu;
}

function buildEditMenu(): HTMLElement {
  const menu = makeMenu();
  // The user was focused on the terminal / an input before opening the menu;
  // restore that focus before dispatching so webContents edit commands (copy/
  // paste/undo/…) act on the element they expect, not on the menu button.
  const prevFocus = document.activeElement as HTMLElement | null;
  const dispatch = (action: EditAction): void => {
    queueMicrotask(() => {
      prevFocus?.focus?.();
      void window.vibeyard.menu.runEditAction(action);
    });
  };

  const groups: Array<EditAction | 'sep'> = [
    'undo', 'redo', 'sep', 'cut', 'copy', 'paste', 'sep', 'delete', 'selectAll',
  ];
  for (const g of groups) {
    if (g === 'sep') addSeparator(menu);
    else addItem(menu, t(`titleBar.edit.${g}`), () => dispatch(g));
  }
  return menu;
}

function buildViewMenu(): HTMLElement {
  const menu = makeMenu();
  addItem(menu, t('titleBar.view.toggleSplit'), () => appState.toggleSwarm(), keysFor('toggle-split'));
  addSeparator(menu);
  addItem(menu, t('titleBar.view.toggleInspector'), toggleInspector, keysFor('toggle-inspector'));
  if (appState.preferences.debugMode) {
    addSeparator(menu);
    addItem(menu, t('titleBar.view.toggleDebugPanel'), toggleDebugPanel, keysFor('debug-panel'));
    addSeparator(menu);
    addItem(menu, t('titleBar.view.toggleDevTools'), () => void window.vibeyard.menu.toggleDevTools());
    addItem(menu, t('titleBar.view.reloadMainWindow'), () => void window.vibeyard.menu.reloadMainWindow());
  }
  return menu;
}
