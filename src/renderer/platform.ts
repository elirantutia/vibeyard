/**
 * Centralized platform detection for the renderer process.
 *
 * Import `isMac`/`isWin`/`isLinux` from here instead of inlining
 * `navigator.platform` checks. Mirrors `src/main/platform.ts` for
 * the main process.
 */

const platform = typeof navigator !== 'undefined' && navigator.platform
  ? navigator.platform.toUpperCase()
  : '';

export const isMac = platform.indexOf('MAC') >= 0;
export const isWin = platform.indexOf('WIN') >= 0;
export const isLinux = !isMac && !isWin;
