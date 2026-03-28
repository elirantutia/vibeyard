import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { getFullPath } from '../pty-manager';

const COMMON_BIN_DIRS = [
  '/usr/local/bin',
  '/opt/homebrew/bin',
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), '.npm-global', 'bin'),
];

export function resolveBinary(binaryName: string, cache: { path: string | null }): string {
  if (cache.path) return cache.path;

  const fullPath = getFullPath();
  const candidates = COMMON_BIN_DIRS.map(dir => path.join(dir, binaryName));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cache.path = candidate;
        return candidate;
      }
    } catch {}
  }

  try {
    const resolved = execSync(`which ${binaryName}`, {
      env: { ...process.env, PATH: fullPath },
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
    if (resolved) {
      cache.path = resolved;
      return resolved;
    }
  } catch (err) {
    console.warn(`Failed to resolve ${binaryName} path via which:`, err);
  }

  cache.path = binaryName;
  return binaryName;
}

export function validateBinaryExists(
  binaryName: string,
  displayName: string,
  installCommand: string,
): { ok: boolean; message: string } {
  const candidates = COMMON_BIN_DIRS.map(dir => path.join(dir, binaryName));

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return { ok: true, message: '' };
    } catch {}
  }

  try {
    const currentPath = process.env.PATH || '';
    const extraDirs = [
      ...COMMON_BIN_DIRS,
      '/usr/local/sbin',
      '/opt/homebrew/sbin',
    ];
    const pathSet = new Set(currentPath.split(':'));
    for (const dir of extraDirs) {
      pathSet.add(dir);
    }
    const augmentedPath = Array.from(pathSet).join(':');

    const resolved = execSync(`which ${binaryName}`, {
      env: { ...process.env, PATH: augmentedPath },
      encoding: 'utf-8',
      timeout: 3000,
    }).trim();
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
