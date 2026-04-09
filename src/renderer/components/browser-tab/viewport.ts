import type { BrowserTabInstance, ViewportPreset } from './types.js';

export function applyViewport(instance: BrowserTabInstance, preset: ViewportPreset): void {
  instance.currentViewport = preset;

  const label = preset.width !== null ? `${preset.width}×${preset.height}` : 'Responsive';
  instance.viewportBtn.textContent = label;
  instance.viewportBtn.classList.toggle('active', preset.width !== null);

  const webviewEl = instance.webview as unknown as HTMLElement;
  if (preset.width !== null) {
    instance.viewportContainer.classList.remove('responsive');
    webviewEl.style.width = `${preset.width}px`;
    webviewEl.style.height = `${preset.height}px`;
    webviewEl.style.flex = 'none';
  } else {
    instance.viewportContainer.classList.add('responsive');
    webviewEl.style.width = '';
    webviewEl.style.height = '';
    webviewEl.style.flex = '';
  }
}

export function openViewportDropdown(instance: BrowserTabInstance): void {
  instance.viewportDropdown.classList.add('visible');
}

export function closeViewportDropdown(instance: BrowserTabInstance): void {
  instance.viewportDropdown.classList.remove('visible');
}

export function getViewportContext(instance: BrowserTabInstance, include: boolean): string {
  if (!include) return '';
  const vp = instance.currentViewport;
  if (vp.width !== null) {
    return ` [viewport: ${vp.width}×${vp.height} – ${vp.label}]`;
  }
  const el = instance.webview as unknown as HTMLElement;
  const rect = el.getBoundingClientRect();
  const w = Math.round(rect.width);
  const h = Math.round(rect.height);
  if (!w || !h) return '';
  return ` [viewport: ${w}×${h} – Responsive]`;
}
