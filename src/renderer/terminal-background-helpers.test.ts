import { describe, expect, it } from 'vitest';
import type { Preferences, TerminalBackgroundMode } from '../shared/types.js';
import {
  backdropIsActive,
  effectiveTerminalBackgroundMode,
  getPresetGradientCss,
  getTerminalSurfaceBackgroundColor,
  normalizePresetId,
} from './terminal-background-helpers.js';

function prefs(p: Partial<Preferences>): Preferences {
  return {
    soundOnSessionWaiting: true,
    notificationsDesktop: true,
    debugMode: false,
    sessionHistoryEnabled: true,
    insightsEnabled: true,
    autoTitleEnabled: true,
    ...p,
  } as Preferences;
}

describe('terminal-background-helpers', () => {
  it('getTerminalSurfaceBackgroundColor is opaque when backdrop inactive', () => {
    expect(getTerminalSurfaceBackgroundColor(prefs({ terminalBackgroundMode: 'none' }))).toBe('#000000');
    expect(getTerminalSurfaceBackgroundColor(undefined)).toBe('#000000');
  });

  it('getTerminalSurfaceBackgroundColor uses alpha when preset active', () => {
    const c = getTerminalSurfaceBackgroundColor(
      prefs({ terminalBackgroundMode: 'preset', terminalBackgroundSurfaceAlpha: 0.5 }),
    );
    expect(c).toBe('rgba(0,0,0,0.5)');
  });

  it('backdropIsActive for custom requires path', () => {
    expect(backdropIsActive(prefs({ terminalBackgroundMode: 'custom', terminalBackgroundImagePath: '/a.png' }))).toBe(true);
    expect(backdropIsActive(prefs({ terminalBackgroundMode: 'custom', terminalBackgroundImagePath: null }))).toBe(false);
  });

  it('effectiveTerminalBackgroundMode normalizes casing', () => {
    expect(
      effectiveTerminalBackgroundMode(prefs({ terminalBackgroundMode: 'PRESET' as unknown as TerminalBackgroundMode })),
    ).toBe('preset');
    expect(
      effectiveTerminalBackgroundMode(prefs({ terminalBackgroundMode: '  Custom ' as unknown as TerminalBackgroundMode })),
    ).toBe('custom');
  });

  it('normalizePresetId falls back for unknown id', () => {
    expect(normalizePresetId('nope')).toBe('metro');
  });

  it('getPresetGradientCss returns a gradient string', () => {
    const g = getPresetGradientCss('metro');
    expect(g).toContain('linear-gradient');
  });
});
