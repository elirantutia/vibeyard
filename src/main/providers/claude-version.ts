import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { getFullPath } from '../pty-manager';
import { SCRIPT_DIR } from '../hook-status';

// Persistent cache of the detected CLI version, keyed by the binary's mtime.
// `claude --version` is a process spawn that runs on every launch (hook-event
// gating, the keychain guard, settings validation), so a warm launch pays it
// for no reason when the binary is unchanged. The cache lives in SCRIPT_DIR
// (~/.vibeyard/run) and is only trusted while the binary's mtime matches the
// one recorded at write time — an updated or replaced binary changes the mtime
// and forces a fresh spawn.
const VERSION_CACHE_FILE = path.join(SCRIPT_DIR, 'claude-version-cache.json');

interface VersionCacheEntry {
  binaryPath: string;
  mtimeMs: number;
  version: string | null;
}

let versionCache: VersionCacheEntry | null = null;

function readVersionCache(): VersionCacheEntry | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(VERSION_CACHE_FILE, 'utf-8')) as VersionCacheEntry;
    if (typeof parsed.binaryPath === 'string' && typeof parsed.mtimeMs === 'number') {
      return parsed;
    }
  } catch {
    // Missing or corrupt cache — fall through to a fresh detection.
  }
  return null;
}

function writeVersionCache(entry: VersionCacheEntry): void {
  try {
    fs.mkdirSync(SCRIPT_DIR, { recursive: true });
    fs.writeFileSync(VERSION_CACHE_FILE, JSON.stringify(entry, null, 2));
  } catch {
    // The cache is an optimization only — a failed write must never break
    // version detection, so swallow it.
  }
}

/**
 * Detect the installed Claude Code CLI version by running `<binary> --version`.
 * Returns a semver string (e.g. "2.1.89") or null if detection fails.
 * Cached per resolved binary path, and persisted across launches (guarded by
 * the binary's mtime) so a warm launch skips the spawn entirely.
 */
export function getClaudeVersion(binaryPath: string): string | null {
  if (versionCache && versionCache.binaryPath === binaryPath) {
    return versionCache.version;
  }

  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(binaryPath).mtimeMs;
  } catch {
    // Binary not on disk (e.g. a bare name that resolves via PATH at spawn
    // time) — nothing to cache against, so always re-detect.
    const version = detectVersion(binaryPath);
    versionCache = { binaryPath, mtimeMs: 0, version };
    return version;
  }

  const cached = readVersionCache();
  if (cached && cached.binaryPath === binaryPath && cached.mtimeMs === mtimeMs) {
    versionCache = { binaryPath, mtimeMs, version: cached.version };
    return cached.version;
  }

  const version = detectVersion(binaryPath);
  versionCache = { binaryPath, mtimeMs, version };
  writeVersionCache({ binaryPath, mtimeMs, version });
  return version;
}

function detectVersion(binaryPath: string): string | null {
  let version: string | null = null;
  try {
    const out = execSync(`"${binaryPath}" --version`, {
      env: { ...process.env, PATH: getFullPath() },
      encoding: 'utf-8',
      timeout: 3000,
    });
    const m = out.match(/(\d+\.\d+\.\d+)/);
    if (m) version = m[1];
  } catch {
    version = null;
  }
  return version;
}

/** @internal Test-only: forget the in-process version cache. */
export function _resetVersionCache(): void {
  versionCache = null;
}
