import { describe, it, expect, vi } from 'vitest';
import type { Preferences } from '../shared/types';

vi.mock('./platform', () => ({
  isWin: true,
  isWslMode: (prefs?: Preferences) => Boolean(prefs?.wslEnabled),
}));

vi.mock('./wsl', () => ({
  getDefaultWslDistro: () => 'Ubuntu',
  getEffectiveDistro: (pref?: string) => pref ?? 'Ubuntu',
  wslPathToWin: (linuxPath: string, distro = 'Ubuntu') =>
    `\\\\wsl$\\${distro}${linuxPath.replace(/\//g, '\\')}`,
}));

import { collectBackgroundImageCandidates } from './background-image-read';

describe('collectBackgroundImageCandidates (Windows + mocked WSL)', () => {
  it('does not add \\\\wsl$\\ UNC fallbacks when WSL2 mode is off', () => {
    const c = collectBackgroundImageCandidates('/home/u/bg.png', {
      wslEnabled: false,
      wslDistro: 'Ubuntu',
    } as Preferences);
    expect(c.some((p) => /wsl\$/i.test(p))).toBe(false);
  });

  it('adds \\\\wsl$\\ UNC fallbacks when WSL2 mode is on', () => {
    const c = collectBackgroundImageCandidates('/home/u/bg.png', {
      wslEnabled: true,
      wslDistro: 'Ubuntu',
    } as Preferences);
    expect(c.some((p) => /wsl\$/i.test(p) && p.includes('home'))).toBe(true);
  });
});
