import type { Terminal } from '@xterm/xterm';
import { isMac } from '../platform.js';
import { wrapBracketedPaste } from './terminal-utils.js';

let activeMenu: HTMLElement | null = null;

function makeItem(label: string, shortcut?: string): HTMLDivElement {
  const item = document.createElement('div');
  item.className = 'tab-context-menu-item';
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  item.appendChild(labelSpan);
  if (shortcut) {
    const hint = document.createElement('span');
    hint.className = 'shortcut-hint';
    hint.textContent = shortcut;
    item.appendChild(hint);
  }
  return item;
}

function onDocumentClick(): void {
  hideTerminalContextMenu();
}

function onDocumentKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') hideTerminalContextMenu();
}

export function showTerminalContextMenu(
  x: number,
  y: number,
  terminal: Terminal,
  writeToPty: (data: string) => void
): void {
  hideTerminalContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const hasSelection = terminal.hasSelection();

  const copyItem = makeItem('Copy', isMac ? '⇧⌘C' : 'Ctrl+Shift+C');
  if (!hasSelection) copyItem.classList.add('disabled');
  if (hasSelection) {
    copyItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTerminalContextMenu();
      terminal.focus();
      const selection = terminal.getSelection();
      if (selection) navigator.clipboard.writeText(selection).catch(() => {});
    });
  }
  menu.appendChild(copyItem);

  const pasteItem = makeItem('Paste', isMac ? '⌘V' : 'Ctrl+V');
  pasteItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTerminalContextMenu();
    terminal.focus();
    navigator.clipboard.readText().then((text) => {
      if (!text) return;
      writeToPty(wrapBracketedPaste(terminal, text));
    }).catch(() => {});
  });
  menu.appendChild(pasteItem);

  const sep1 = document.createElement('div');
  sep1.className = 'tab-context-menu-separator';
  menu.appendChild(sep1);

  const selectAllItem = makeItem('Select All');
  selectAllItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTerminalContextMenu();
    terminal.focus();
    terminal.selectAll();
  });
  menu.appendChild(selectAllItem);

  document.body.appendChild(menu);
  activeMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
}

export function hideTerminalContextMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
    document.removeEventListener('click', onDocumentClick);
    document.removeEventListener('keydown', onDocumentKeydown);
  }
}
