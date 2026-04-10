/**
 * Centralized platform detection and derived constants for the main process.
 *
 * Import `isWin`/`isMac`/`isLinux` from here instead of inlining
 * `process.platform === 'win32'` or redefining `isWin` locally. This keeps
 * platform-conditional logic discoverable and prevents drift across modules.
 */

import type { Preferences } from '../shared/types';

export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

/** PATH environment variable separator. */
export const pathSep = isWin ? ';' : ':';

/** Command used to resolve a binary on PATH. */
export const whichCmd = isWin ? 'where' : 'which';

/** Python interpreter used by hook scripts. */
export const pythonBin = isWin ? 'python' : '/usr/bin/python3';

/**
 * Returns true when WSL execution mode is active.
 * This is only possible on Windows with `wslEnabled` set in preferences.
 * Lazily imports the WSL module to avoid pulling it in on non-Windows platforms.
 */
export function isWslMode(prefs?: Preferences): boolean {
  if (!isWin) return false;
  if (!prefs?.wslEnabled) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { isWslAvailable } = require('./wsl') as typeof import('./wsl');
  return isWslAvailable();
}
