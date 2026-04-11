import type { Terminal } from '@xterm/xterm';
import { isMac } from '../platform.js';

let activeMenu: HTMLElement | null = null;

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

  // Copy
  const copyItem = document.createElement('div');
  copyItem.className = 'tab-context-menu-item' + (hasSelection ? '' : ' disabled');
  copyItem.innerHTML = `<span>Copy</span><span class="shortcut-hint">${isMac ? '⇧⌘C' : 'Ctrl+Shift+C'}</span>`;
  if (hasSelection) {
    copyItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTerminalContextMenu();
      const selection = terminal.getSelection();
      if (selection) navigator.clipboard.writeText(selection).catch(() => {});
    });
  }
  menu.appendChild(copyItem);

  // Paste
  const pasteItem = document.createElement('div');
  pasteItem.className = 'tab-context-menu-item';
  pasteItem.innerHTML = `<span>Paste</span><span class="shortcut-hint">${isMac ? '⌘V' : 'Ctrl+V'}</span>`;
  pasteItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTerminalContextMenu();
    navigator.clipboard.readText().then((text) => {
      if (!text) return;
      const modes = (terminal as any).modes;
      const bp = modes?.bracketedPasteMode;
      writeToPty(bp ? `\x1b[200~${text}\x1b[201~` : text);
    }).catch(() => {});
  });
  menu.appendChild(pasteItem);

  // Separator
  const sep1 = document.createElement('div');
  sep1.className = 'tab-context-menu-separator';
  menu.appendChild(sep1);

  // Select All
  const selectAllItem = document.createElement('div');
  selectAllItem.className = 'tab-context-menu-item';
  selectAllItem.textContent = 'Select All';
  selectAllItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTerminalContextMenu();
    terminal.selectAll();
  });
  menu.appendChild(selectAllItem);

  // Separator
  const sep2 = document.createElement('div');
  sep2.className = 'tab-context-menu-separator';
  menu.appendChild(sep2);

  // Clear Terminal
  const clearItem = document.createElement('div');
  clearItem.className = 'tab-context-menu-item';
  clearItem.textContent = 'Clear Terminal';
  clearItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTerminalContextMenu();
    terminal.clear();
  });
  menu.appendChild(clearItem);

  document.body.appendChild(menu);
  activeMenu = menu;

  // Adjust if menu goes off-screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

export function hideTerminalContextMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

// Global dismiss listeners
document.addEventListener('click', hideTerminalContextMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTerminalContextMenu(); });
