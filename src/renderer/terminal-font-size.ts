import type { Terminal } from '@xterm/xterm';
import { appState } from './state.js';

export const DEFAULT_TERMINAL_FONT_SIZE = 14;

/** Min/max terminal font (px) — keyboard nudges by 1 within this range. */
export const TERMINAL_FONT_MIN = 10;
export const TERMINAL_FONT_MAX = 32;

/** Every integer px for Preferences (matches shortcut steps). */
export const TERMINAL_FONT_SIZE_OPTIONS: readonly number[] = Array.from(
  { length: TERMINAL_FONT_MAX - TERMINAL_FONT_MIN + 1 },
  (_, i) => TERMINAL_FONT_MIN + i,
);

export function getEffectiveTerminalFontSize(): number {
  const n = appState.preferences?.terminalFontSize;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_TERMINAL_FONT_SIZE;
  return Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, Math.round(n)));
}

/** Apply font size and force a full redraw (WebGL/canvas can ignore a bare `options.fontSize` write). */
export function applyXtermFontSize(terminal: Terminal, fontSize: number): void {
  terminal.options.fontSize = fontSize;
  const end = Math.max(0, terminal.rows - 1);
  terminal.refresh(0, end);
}

export function stepTerminalFontSize(direction: 1 | -1): void {
  const cur = getEffectiveTerminalFontSize();
  const next = Math.min(TERMINAL_FONT_MAX, Math.max(TERMINAL_FONT_MIN, cur + direction));
  appState.setPreference('terminalFontSize', next);
}
