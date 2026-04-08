import type { BrowserTabInstance } from './types.js';

/**
 * Position a popover element at webview-local (x, y), translating to pane-local
 * coordinates and clamping within the pane bounds. The popover must already be
 * visible so its rendered size can be measured.
 */
export function positionPopover(
  instance: BrowserTabInstance,
  popover: HTMLElement,
  x: number,
  y: number,
): void {
  const webviewRect = (instance.webview as unknown as HTMLElement).getBoundingClientRect();
  const paneRect = instance.element.getBoundingClientRect();
  let left = webviewRect.left - paneRect.left + x;
  let top = webviewRect.top - paneRect.top + y;

  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;

  const rect = popover.getBoundingClientRect();
  const paneWidth = paneRect.width;
  const paneHeight = paneRect.height;
  if (left + rect.width > paneWidth) left = paneWidth - rect.width - 8;
  if (top + rect.height > paneHeight) top = paneHeight - rect.height - 8;
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
}
