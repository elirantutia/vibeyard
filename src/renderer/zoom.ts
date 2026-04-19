import { appState } from './state.js';
import { fitAllVisible } from './components/terminal-pane.js';
import { ZOOM_MIN, ZOOM_MAX } from '../shared/types.js';

export const ZOOM_STEPS = [0.75, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0] as const;

export function getZoomFactor(): number {
  return appState.preferences.zoomFactor ?? 1.0;
}

export function applyZoom(factor: number): void {
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, factor));
  if (clamped === getZoomFactor()) return;
  appState.setPreference('zoomFactor', clamped);
  window.vibeyard.zoom.set(clamped);
  requestAnimationFrame(() => fitAllVisible());
}

export function zoomIn(): void {
  const next = ZOOM_STEPS.find((s) => s > getZoomFactor());
  if (next !== undefined) applyZoom(next);
}

export function zoomOut(): void {
  const prev = ZOOM_STEPS.findLast((s) => s < getZoomFactor());
  if (prev !== undefined) applyZoom(prev);
}

export function zoomReset(): void {
  applyZoom(1.0);
}
