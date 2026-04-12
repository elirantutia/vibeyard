import * as os from 'os';
import * as path from 'path';
import { isWin, pathSep } from './platform';

/**
 * Rebuild PATH so user-local and common install dirs are searched before
 * system paths. Fixes `which` picking an older `/usr/local/bin/foo` when a
 * newer copy exists under `~/.local/bin` (npm global default on Linux).
 */
export function mergePreferredBinDirsFirst(pathEnv: string): string {
  const home = os.homedir();
  const preferred = isWin
    ? [path.join(home, 'AppData', 'Roaming', 'npm'), path.join(home, '.local', 'bin')]
    : [
        path.join(home, '.local', 'bin'),
        path.join(home, '.npm-global', 'bin'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
      ];
  const parts = pathEnv.split(pathSep).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...preferred, ...parts]) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out.join(pathSep);
}
