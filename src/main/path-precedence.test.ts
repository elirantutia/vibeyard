import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./platform', () => ({
  isWin: false,
  pathSep: ':',
}));

vi.mock('os', () => ({
  homedir: vi.fn(() => '/home/tester'),
}));

import { mergePreferredBinDirsFirst } from './path-precedence';

describe('mergePreferredBinDirsFirst', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prepends user-local dirs before system paths', () => {
    const out = mergePreferredBinDirsFirst('/usr/local/bin:/usr/bin:/bin');
    expect(out.split(':')[0]).toBe('/home/tester/.local/bin');
    expect(out.split(':')[1]).toBe('/home/tester/.npm-global/bin');
    expect(out).toContain('/opt/homebrew/bin');
    expect(out).toContain('/usr/local/bin');
    expect(out.indexOf('/home/tester/.local/bin')).toBeLessThan(out.indexOf('/usr/local/bin'));
  });

  it('dedupes repeated segments', () => {
    const out = mergePreferredBinDirsFirst('/usr/local/bin:/home/tester/.local/bin:/usr/local/bin');
    const parts = out.split(':');
    expect(parts.filter((p) => p === '/usr/local/bin').length).toBe(1);
  });
});
