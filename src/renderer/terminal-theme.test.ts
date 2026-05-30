import { describe, it, expect } from 'vitest';
import { darkTerminalTheme, lightTerminalTheme, getTerminalTheme } from './terminal-theme';

describe('darkTerminalTheme', () => {
  it('has the correct background', () => {
    expect(darkTerminalTheme.background).toBe('#0e0f13');
  });

  it('has the correct foreground', () => {
    expect(darkTerminalTheme.foreground).toBe('#e9eaf1');
  });
});

describe('lightTerminalTheme', () => {
  it('has the correct background', () => {
    expect(lightTerminalTheme.background).toBe('#f7f7fb');
  });

  it('has the correct foreground', () => {
    expect(lightTerminalTheme.foreground).toBe('#1c1e26');
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
  it('uses the iris accent per theme', () => {
    expect(darkTerminalTheme.cursor).toBe('#8588f2');
    expect(lightTerminalTheme.cursor).toBe('#5a5ee6');
  });
});
