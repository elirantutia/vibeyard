/**
 * Login-shell / registry PATH resolution, kept free of other main-process
 * imports so low-level modules (e.g. python-bin.ts, which the hook and
 * statusLine installers depend on) can use it without an import cycle
 * through pty-manager. Re-exported from pty-manager for existing callers.
 */
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { isWin, pathSep } from './platform';
import { nvmDefaultNodeBinDir } from './providers/nvm';

/**
 * Get the full PATH by sourcing the user's login shell.
 * When Electron is launched from macOS Finder/Dock, process.env.PATH
 * is minimal (/usr/bin:/bin:/usr/sbin:/sbin) and misses nvm, homebrew, etc.
 * On Windows, packaged Electron apps inherit PATH from explorer.exe which
 * may be stale — we read the registry for the current PATH.
 * We resolve this once by running a login shell / reading the registry.
 */
let cachedFullPath: string | null = null;

const PATH_MARKER_BEGIN = '__VY_PATH_BEGIN__';
const PATH_MARKER_END = '__VY_PATH_END__';

export function getRegistryPath(): string {
  if (!isWin) return '';

  const parse = (output: string): string => {
    const match = output.match(/REG_(?:EXPAND_)?SZ\s+(.+)/);
    if (!match) return '';
    let value = match[1].trim();
    value = value.replace(/%([^%]+)%/g, (_m, varName) => process.env[varName] || `%${varName}%`);
    return value;
  };

  let systemPath = '';
  try {
    systemPath = parse(execSync(
      'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v Path',
      { encoding: 'utf-8', timeout: 3000, windowsHide: true },
    ));
  } catch {}

  let userPath = '';
  try {
    userPath = parse(execSync(
      'reg query "HKCU\\Environment" /v Path',
      { encoding: 'utf-8', timeout: 3000, windowsHide: true },
    ));
  } catch {}

  return [systemPath, userPath].filter(Boolean).join(pathSep);
}

/** Reset cached PATH (used after install-then-retry flows and in tests). */
export function resetPathCache(): void {
  cachedFullPath = null;
}

export function getFullPath(): string {
  if (cachedFullPath) return cachedFullPath;

  const currentPath = process.env.PATH || '';

  if (isWin) {
    const home = os.homedir();
    const extraDirs = [
      path.join(home, 'AppData', 'Roaming', 'npm'),
      path.join(home, '.local', 'bin'),
    ];

    // Read the up-to-date PATH from the Windows registry
    const registryPath = getRegistryPath();

    const pathSet = new Set([
      ...currentPath.split(pathSep),
      ...registryPath.split(pathSep),
    ]);
    for (const dir of extraDirs) {
      pathSet.add(dir);
    }
    cachedFullPath = Array.from(pathSet).join(pathSep);
    return cachedFullPath;
  }

  const shell = process.env.SHELL || '/bin/zsh';

  // -i is required: nvm exports PATH from ~/.zshrc, only sourced for interactive shells.
  try {
    const shellPath = execSync(
      `${shell} -ilc 'echo "${PATH_MARKER_BEGIN}${'${PATH}'}${PATH_MARKER_END}"'`,
      {
        encoding: 'utf-8',
        timeout: 8000,
        env: { ...process.env, HOME: os.homedir() },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const match = shellPath.match(
      new RegExp(`${PATH_MARKER_BEGIN}([\\s\\S]*?)${PATH_MARKER_END}`),
    );
    if (match && match[1]) {
      cachedFullPath = match[1].trim();
      return cachedFullPath;
    }
  } catch (err) { console.warn('Failed to resolve PATH from login shell:', err); }

  const home = os.homedir();
  const extraDirs = [
    '/usr/local/bin',
    '/opt/homebrew/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    '/usr/local/sbin',
    '/opt/homebrew/sbin',
  ];
  const nvmBin = nvmDefaultNodeBinDir();
  if (nvmBin) extraDirs.push(nvmBin);

  const pathSet = new Set(currentPath.split(pathSep));
  for (const dir of extraDirs) {
    pathSet.add(dir);
  }
  cachedFullPath = Array.from(pathSet).join(pathSep);
  return cachedFullPath;
}
