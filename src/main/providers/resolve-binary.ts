import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getFullPath } from '../pty-manager';
import { isWin, whichCmd } from '../platform';

const COMMON_BIN_DIRS = isWin
  ? [
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs'),
      path.join(os.homedir(), '.local', 'bin'),
    ]
  : [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), '.npm-global', 'bin'),
    ];

// On Windows, CLI tools installed via npm are .cmd shims
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
    // 'where' on Windows may return multiple lines — take the first
    const firstLine = resolved.split(/\r?\n/)[0];
    return firstLine || null;
  } catch {
    return null;
  }
}

export function resolveBinary(binaryName: string, cache: { path: string | null }): string {
  if (cache.path) return cache.path;

  const fullPath = getFullPath();

  for (const dir of COMMON_BIN_DIRS) {
    const found = findBinaryInDir(dir, binaryName);
    if (found) {
      cache.path = found;
      return found;
    }
  }

  const resolved = whichBinary(binaryName, fullPath);
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
  for (const dir of COMMON_BIN_DIRS) {
    if (findBinaryInDir(dir, binaryName)) return { ok: true, message: '' };
  }

  if (whichBinary(binaryName, getFullPath())) return { ok: true, message: '' };

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
