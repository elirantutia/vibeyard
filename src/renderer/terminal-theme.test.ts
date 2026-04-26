import { describe, it, expect } from 'vitest';
import { darkTerminalTheme, lightTerminalTheme, getTerminalTheme } from './terminal-theme';

describe('darkTerminalTheme', () => {
  it('has the correct background', () => {
    expect(darkTerminalTheme.background).toBe('#000000');
  });

  it('has the correct foreground', () => {
    expect(darkTerminalTheme.foreground).toBe('#e0e0e0');
  });
});

describe('lightTerminalTheme', () => {
  it('has the correct background', () => {
    expect(lightTerminalTheme.background).toBe('#fafaf8');
  });

  it('has the correct foreground', () => {
    expect(lightTerminalTheme.foreground).toBe('#2c2c2c');
  });

  it('keeps ansi white visible against the background', () => {
    expect(lightTerminalTheme.white).toBe('#6b7280');
    expect(lightTerminalTheme.white).not.toBe(lightTerminalTheme.background);
    expect(lightTerminalTheme.brightWhite).toBe('#2c2c2c');
  });
});

describe('getTerminalTheme()', () => {
  it('returns darkTerminalTheme for "dark"', () => {
    expect(getTerminalTheme('dark')).toBe(darkTerminalTheme);
  });

  it('returns lightTerminalTheme for "light"', () => {
    expect(getTerminalTheme('light')).toBe(lightTerminalTheme);
  });
});

describe('cursor color', () => {
  it('dark and light themes share the same cursor color', () => {
    expect(darkTerminalTheme.cursor).toBe('#e94560');
    expect(lightTerminalTheme.cursor).toBe('#e94560');
  });
});
