import type { BrowserTabInstance } from './types.js';

export function normalizeUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed && !/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return 'http://' + trimmed;
  }
  return trimmed;
}

export function navigateTo(instance: BrowserTabInstance, url: string): void {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) return;
  instance.urlInput.value = normalizedUrl;
  instance.webview.src = normalizedUrl;
  instance.newTabPage.style.display = 'none';
}
