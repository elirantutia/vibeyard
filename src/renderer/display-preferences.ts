import { appState } from './state.js';
import {
  getEffectiveTerminalFontSize,
  applyXtermFontSize,
  TERMINAL_FONT_MIN,
  TERMINAL_FONT_MAX,
} from './terminal-font-size.js';
import { getAllInstances, fitAllVisible } from './components/terminal-pane.js';
import { applyShellTerminalsFontSize } from './components/project-terminal.js';
import { applyRemoteTerminalsFontSize } from './components/remote-terminal-pane.js';

export const DEFAULT_UI_ZOOM = 1;

/** Interface scale range for prefs + keyboard (Chromium zoom factor). */
export const UI_ZOOM_MIN = 1;
export const UI_ZOOM_MAX = 2;
export const UI_ZOOM_STEP = 0.05;

/** Every step for Preferences (same grid as Ctrl+/Ctrl-). */
export const UI_ZOOM_SIZE_OPTIONS: readonly number[] = Array.from(
  { length: Math.floor((UI_ZOOM_MAX - UI_ZOOM_MIN) / UI_ZOOM_STEP) + 1 },
  (_, i) => Math.round((UI_ZOOM_MIN + i * UI_ZOOM_STEP) * 100) / 100,
);

function snapUiZoom(z: number): number {
  return Math.round(Math.min(UI_ZOOM_MAX, Math.max(UI_ZOOM_MIN, z)) * 100) / 100;
}

/** One keyboard step: interface zoom (+/- 5%) + terminal font (+/- 1px), both persist. */
export function stepUiAndTerminalZoom(direction: 1 | -1): void {
  const z = snapUiZoom(effectiveUiZoom());
  const nz = snapUiZoom(z + direction * UI_ZOOM_STEP);

  const curF = getEffectiveTerminalFontSize();
  const nf = Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, curF + direction));

  appState.patchPreferences({
    uiZoom: nz,
    terminalFontSize: nf,
  });
}
export { DEFAULT_TERMINAL_FONT_SIZE } from './terminal-font-size.js';

function effectiveUiZoom(): number {
  const z = appState.preferences?.uiZoom;
  if (typeof z !== 'number' || !Number.isFinite(z) || z < 0.5 || z > 4) return DEFAULT_UI_ZOOM;
  return z;
}

/**
 * Whole-app scale via Electron `webContents.setZoomFactor` (Chromium page zoom).
 * Avoids CSS `zoom`, which breaks flex layout (terminal gutter / clipped chrome) on Windows.
 */
export async function applyUiZoom(): Promise<void> {
  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.style.removeProperty('zoom');
    appEl.style.removeProperty('width');
    appEl.style.removeProperty('height');
  }
  document.documentElement.classList.remove('ui-zoom-active');
  document.documentElement.style.removeProperty('--app-ui-zoom');

  const zoom = effectiveUiZoom();
  try {
    await window.vibeyard.app.setZoomFactor(zoom);
  } catch {
    // Tests or environments without the IPC bridge
  }
}

/** Update xterm font size on every terminal instance and refit visible panes. */
export function applyAllTerminalFontSizes(): void {
  const fontSize = getEffectiveTerminalFontSize();
  for (const [, inst] of getAllInstances()) {
    applyXtermFontSize(inst.terminal, fontSize);
  }
  applyShellTerminalsFontSize(fontSize);
  applyRemoteTerminalsFontSize(fontSize);
  fitAllVisible();
}

export async function applyDisplayPreferences(): Promise<void> {
  await applyUiZoom();
  applyAllTerminalFontSizes();
  window.dispatchEvent(new Event('resize'));
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
  });
}
