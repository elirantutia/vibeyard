/**
 * Centralized platform detection and derived constants for the main process.
 *
 * Import `isWin`/`isMac`/`isLinux` from here instead of inlining
 * `process.platform === 'win32'` or redefining `isWin` locally. This keeps
 * platform-conditional logic discoverable and prevents drift across modules.
 */

export const isWin = process.platform === 'win32';
export const isMac = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';

/** PATH environment variable separator. */
export const pathSep = isWin ? ';' : ':';

/** Command used to resolve a binary on PATH. */
export const whichCmd = isWin ? 'where' : 'which';

/**
 * Locale vars that force a UTF-8 charset on spawned children. `LC_CTYPE=UTF-8`
 * is what Terminal.app sets when it can't map the region; `C.UTF-8` is always
 * present on glibc >= 2.27 and musl. Empty on Windows, which is not locale-env
 * driven.
 */
export const utf8LocaleEnv: Record<string, string> =
  isWin ? {} : isMac ? { LC_CTYPE: 'UTF-8' } : { LANG: 'C.UTF-8' };

/** Python interpreter used by hook scripts. */
export const pythonBin = isWin ? 'python' : '/usr/bin/python3';
