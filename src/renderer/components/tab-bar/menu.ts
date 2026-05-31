// Shared context-menu infrastructure for the tab bar. There is a single
// open context menu at a time (tab menu, branch menu, or "More" menu); this
// module owns that state and the dismiss/position helpers.

let activeContextMenu: HTMLElement | null = null;

export function getActiveContextMenu(): HTMLElement | null {
  return activeContextMenu;
}

export function setActiveContextMenu(el: HTMLElement | null): void {
  activeContextMenu = el;
}

export function hideTabContextMenu(): void {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

// Clamp a menu so it stays within the viewport.
export function positionMenu(menu: HTMLElement): void {
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}
