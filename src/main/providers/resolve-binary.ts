import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getFullPath } from '../pty-manager';

const IS_WINDOWS = process.platform === 'win32';

const WINDOWS_BIN_DIRS = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),               // npm global
  path.join(os.homedir(), 'AppData', 'Local', 'npm'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'claude-code'), // curl standalone
  path.join(os.homedir(), 'AppData', 'Local', 'AnthropicClaude'),     // curl standalone alt
  path.join(os.homedir(), 'AppData', 'Local', 'Programs'),            // generic Programs dir
  'C:\\Program Files\\nodejs',
  'C:\\Program Files (x86)\\nodejs',
];

const UNIX_BIN_DIRS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.npm-global', 'bin'),
];

const COMMON_BIN_DIRS = IS_WINDOWS ? WINDOWS_BIN_DIRS : UNIX_BIN_DIRS;

export function resolveBinary(binaryName: string, cache: { path: string | null }): string {
  if (cache.path) return cache.path;

  const fullPath = getFullPath();
  const names = IS_WINDOWS ? [binaryName + '.cmd', binaryName + '.exe', binaryName] : [binaryName];
  const candidates = COMMON_BIN_DIRS.flatMap(dir => names.map(n => path.join(dir, n)));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cache.path = candidate;
        return candidate;
      }
    } catch {}
  }

  try {
    const whichCmd = IS_WINDOWS ? `where ${binaryName}` : `which ${binaryName}`;
    const resolved = execSync(whichCmd, {
      env: { ...process.env, PATH: fullPath },
      encoding: 'utf-8',
      timeout: 3000,
    }).trim().split('\n')[0].trim(); // `where` returns multiple lines on Windows
    if (resolved) {
      cache.path = resolved;
      return resolved;
    }
  } catch (err) {
    console.warn(`Failed to resolve ${binaryName} path:`, err);
  }

  cache.path = binaryName;
  return binaryName;
}

export function validateBinaryExists(
  binaryName: string,
  displayName: string,
  installCommand: string,
): { ok: boolean; message: string } {
  const names = IS_WINDOWS ? [binaryName + '.cmd', binaryName + '.exe', binaryName] : [binaryName];
  const candidates = COMMON_BIN_DIRS.flatMap(dir => names.map(n => path.join(dir, n)));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return { ok: true, message: '' };
    } catch {}
  }

  try {
    const whichCmd = IS_WINDOWS ? `where ${binaryName}` : `which ${binaryName}`;
    const resolved = execSync(whichCmd, {
      env: { ...process.env, PATH: getFullPath() },
      encoding: 'utf-8',
      timeout: 3000,
    }).trim().split('\n')[0].trim();
    if (resolved) return { ok: true, message: '' };
  } catch {}

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
