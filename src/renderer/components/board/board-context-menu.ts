let activeMenu: HTMLElement | null = null;
let pendingCloseHandler: ((e: Event) => void) | null = null;

export interface MenuOption {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function showContextMenu(x: number, y: number, options: MenuOption[]): void {
  if (pendingCloseHandler) {
    document.removeEventListener('click', pendingCloseHandler);
    document.removeEventListener('keydown', pendingCloseHandler);
    pendingCloseHandler = null;
  }

  hideContextMenu();

  const menu = document.createElement('div');
  menu.className = 'board-context-menu';

  for (const opt of options) {
    const item = document.createElement('div');
    item.className = 'board-context-menu-item';
    if (opt.danger) item.classList.add('danger');
    if (opt.disabled) item.classList.add('disabled');
    item.textContent = opt.label;
    if (!opt.disabled) {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        hideContextMenu();
        opt.action();
      });
    }
    menu.appendChild(item);
  }

  // Position — clamp to viewport
  menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - options.length * 32 - 16)}px`;

  document.body.appendChild(menu);
  activeMenu = menu;

  // Close on next click or Escape
  const close = (e: Event) => {
    if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
    hideContextMenu();
    document.removeEventListener('click', close);
    document.removeEventListener('keydown', close);
    pendingCloseHandler = null;
  };
  // Delay to avoid the triggering contextmenu click from immediately closing
  requestAnimationFrame(() => {
    document.addEventListener('click', close);
    document.addEventListener('keydown', close);
    pendingCloseHandler = close;
  });
}

export function hideContextMenu(): void {
  if (pendingCloseHandler) {
    document.removeEventListener('click', pendingCloseHandler);
    document.removeEventListener('keydown', pendingCloseHandler);
    pendingCloseHandler = null;
  }
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}
