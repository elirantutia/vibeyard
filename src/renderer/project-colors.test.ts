import { describe, it, expect } from 'vitest';
import { PROJECT_COLOR_PALETTE, normalizeProjectColor } from './project-colors';

describe('normalizeProjectColor', () => {
  it('accepts #rrggbb and lowercases it', () => {
    expect(normalizeProjectColor('#AABBCC')).toBe('#aabbcc');
    expect(normalizeProjectColor(' #12ab9f ')).toBe('#12ab9f');
  });

  it.each(['', 'red', '#abc', '#abcdefg', 'abcdef', '#ggg000', 'rgb(1,2,3)'])('rejects %j', (value) => {
    expect(normalizeProjectColor(value)).toBeUndefined();
  });

  it('rejects null / undefined', () => {
    expect(normalizeProjectColor(undefined)).toBeUndefined();
    expect(normalizeProjectColor(null)).toBeUndefined();
  });
});

describe('PROJECT_COLOR_PALETTE', () => {
  it('holds only canonical, unique colors', () => {
    for (const c of PROJECT_COLOR_PALETTE) expect(normalizeProjectColor(c)).toBe(c);
    expect(new Set(PROJECT_COLOR_PALETTE).size).toBe(PROJECT_COLOR_PALETTE.length);
  });
});
