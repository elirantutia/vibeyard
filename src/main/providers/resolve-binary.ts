import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, execFileSync } from 'child_process';
import { getFullPath } from '../pty-manager';
import { mergePreferredBinDirsFirst } from '../path-precedence';
import { isWin, whichCmd, isWslMode } from '../platform';
import { loadState } from '../store';

// Unix: prefer user-level installs (~/.local/bin from npm -g, etc.) before
// /usr/local and Homebrew so a newer CLI in $HOME wins over an older system copy.
const COMMON_BIN_DIRS = isWin
  ? [
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs'),
      path.join(os.homedir(), '.local', 'bin'),
    ]
  : [
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), '.npm-global', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ];

const WIN_EXTENSIONS = ['.cmd', '.exe', '.ps1', ''];

function findBinaryInDir(dir: string, binaryName: string): string | null {
  if (isWin) {
    for (const ext of WIN_EXTENSIONS) {
      const candidate = path.join(dir, binaryName + ext);
      try { if (fs.existsSync(candidate)) return candidate; } catch {}
    }
    return null;
  }
  const candidate = path.join(dir, binaryName);
  try { if (fs.existsSync(candidate)) return candidate; } catch {}
  return null;
}

function whichBinary(binaryName: string, envPath: string): string | null {
  try {
    const resolved = execSync(`${whichCmd} "${binaryName}"`, {
      env: { ...process.env, PATH: envPath },
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    const firstLine = resolved.split(/\r?\n/)[0];
    return firstLine || null;
  } catch {
    return null;
  }
}

/** Resolve a binary inside WSL via `wsl.exe -d <distro> -- which <binary>`. */
const wslBinaryCache = new Map<string, string>();

function whichBinaryInWsl(binaryName: string, distro: string): string | null {
  const key = `${distro}:${binaryName}`;
  const cached = wslBinaryCache.get(key);
  if (cached) return cached;

  const { getWslHome } = require('../wsl') as typeof import('../wsl');
  const home = getWslHome(distro);
  const candidates = [
    path.posix.join(home, '.local', 'bin', binaryName),
    path.posix.join(home, '.npm-global', 'bin', binaryName),
    path.posix.join('/opt/homebrew', 'bin', binaryName),
    path.posix.join('/usr/local', 'bin', binaryName),
  ];
  for (const c of candidates) {
    try {
      execFileSync('wsl.exe', ['-d', distro, '--', 'test', '-x', c], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 3000,
      });
      wslBinaryCache.set(key, c);
      return c;
    } catch {
      // try next
    }
  }

  const pathPrefix = [
    path.posix.join(home, '.local', 'bin'),
    path.posix.join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ].join(':');
  try {
    const out = execFileSync(
      'wsl.exe',
      ['-d', distro, '--', 'sh', '-c', 'PATH="$1:$PATH" command -v "$2"', '_', pathPrefix, binaryName],
      { encoding: 'utf8', timeout: 5000 },
    )
      .trim()
      .split(/\r?\n/)[0];
    if (out) {
      wslBinaryCache.set(key, out);
      return out;
    }
  } catch {
    // not found
  }
  return null;
}

export function resolveBinary(binaryName: string, cache: { path: string | null }): string {
  if (cache.path) return cache.path;

  const state = loadState();
  if (isWslMode(state.preferences)) {
    const { getEffectiveDistro } = require('../wsl') as typeof import('../wsl');
    const distro = getEffectiveDistro(state.preferences.wslDistro) || 'Ubuntu';
    const resolved = whichBinaryInWsl(binaryName, distro);
    if (resolved) {
      cache.path = resolved;
      return resolved;
    }
    cache.path = binaryName;
    return binaryName;
  }

  const fullPath = getFullPath();

  for (const dir of COMMON_BIN_DIRS) {
    const found = findBinaryInDir(dir, binaryName);
    if (found) {
      cache.path = found;
      return found;
    }
  }

  const resolved = whichBinary(binaryName, mergePreferredBinDirsFirst(fullPath));
  if (resolved) {
    cache.path = resolved;
    return resolved;
  }

  cache.path = binaryName;
  return binaryName;
}

export function validateBinaryExists(
  binaryName: string,
  displayName: string,
  installCommand: string,
): { ok: boolean; message: string } {
  const state = loadState();
  if (isWslMode(state.preferences)) {
    const { getEffectiveDistro } = require('../wsl') as typeof import('../wsl');
    const distro = getEffectiveDistro(state.preferences.wslDistro) || 'Ubuntu';
    if (whichBinaryInWsl(binaryName, distro)) return { ok: true, message: '' };
    return {
      ok: false,
      message:
        `${displayName} not found inside WSL (${distro}).\n\n` +
        `Vibeyard WSL mode requires ${displayName} installed in your WSL distro.\n\n` +
        `Open your WSL terminal and install it with:\n` +
        `  ${installCommand}\n\n` +
        `After installing, restart Vibeyard.`,
    };
  }

  for (const dir of COMMON_BIN_DIRS) {
    if (findBinaryInDir(dir, binaryName)) return { ok: true, message: '' };
  }

  if (whichBinary(binaryName, mergePreferredBinDirsFirst(getFullPath()))) return { ok: true, message: '' };

  return {
    ok: false,
    message:
      `${displayName} not found.\n\n` +
      `Vibeyard requires the ${displayName} to be installed.\n\n` +
      `Install it with:\n` +
      `  ${installCommand}\n\n` +
      `After installing, restart Vibeyard.`,
  };
}
