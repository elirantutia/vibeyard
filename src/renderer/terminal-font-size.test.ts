import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrefs: { terminalFontSize?: number } = {};

vi.mock('./state.js', () => ({
  appState: {
    get preferences() {
      return { terminalFontSize: mockPrefs.terminalFontSize };
    },
  },
}));

describe('getEffectiveTerminalFontSize', () => {
  beforeEach(async () => {
    vi.resetModules();
    mockPrefs.terminalFontSize = undefined;
  });

  it('returns default when unset', async () => {
    const { getEffectiveTerminalFontSize, DEFAULT_TERMINAL_FONT_SIZE } = await import('./terminal-font-size.js');
    expect(getEffectiveTerminalFontSize()).toBe(DEFAULT_TERMINAL_FONT_SIZE);
  });

  it('clamps to 10–32', async () => {
    const { getEffectiveTerminalFontSize } = await import('./terminal-font-size.js');
    mockPrefs.terminalFontSize = 4;
    expect(getEffectiveTerminalFontSize()).toBe(10);
    mockPrefs.terminalFontSize = 99;
    expect(getEffectiveTerminalFontSize()).toBe(32);
    mockPrefs.terminalFontSize = 17.5;
    expect(getEffectiveTerminalFontSize()).toBe(18);
  });
});
