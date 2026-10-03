import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { isWin } from './platform';

/** Root directory holding all auto-managed profile config dirs. */
export const PROFILES_ROOT = path.join(os.homedir(), '.vibeyard', 'profiles');

/** Default managed config dir for a profile id. */
export function managedProfileDir(profileId: string): string {
  return path.join(PROFILES_ROOT, profileId);
}

/**
 * Whether the filesystem holding `dir` (or its nearest existing ancestor)
 * folds letter case in lookups.
 *
 * Probed rather than derived from `process.platform`: APFS can be created
 * either way on macOS, so the platform alone does not answer it. If the
 * anchor cannot be written the probe is impossible, so we fall back to the
 * platform default — Windows folds, and there an unwritable anchor means the
 * eventual `mkdir` would fail anyway.
 */
function foldsCase(dir: string): boolean {
  let anchor = path.resolve(dir);
  while (!fs.existsSync(anchor)) {
    const parent = path.dirname(anchor);
    if (parent === anchor) return true;
    anchor = parent;
  }
  const probe = path.join(anchor, `VibeyardCaseProbe-${process.pid}`);
  const flipped = path.join(anchor, `vibeyardCASEprobe-${process.pid}`);
  try {
    fs.writeFileSync(probe, '');
    return fs.existsSync(flipped);
  } catch {
    return isWin;
  } finally {
    try { fs.unlinkSync(probe); } catch { /* already gone */ }
  }
}

/**
 * Canonical form of a config dir for collision comparison.
 *
 * `path.resolve` alone is not enough. It normalizes `..` but leaves symlinks,
 * Windows 8.3 short names, and letter case intact, so `~/a` symlinked to
 * `~/b`, `C:\\PRO~1\\FOO`, and `c:\\profiles\\foo` all compare unequal while
 * naming one directory — which is exactly how two providers end up silently
 * sharing sessions and auth through a guard meant to stop it. `realpath`
 * collapses the link and short-name forms; the case fold covers the rest on
 * filesystems that fold.
 */
function canonicalDir(dir: string): string {
  let resolved = path.resolve(dir);
  try {
    resolved = fs.realpathSync(resolved);
  } catch {
    // Not created yet (the common case for a fresh profile dir); the resolved
    // path is the best available answer.
  }
  return foldsCase(resolved) ? resolved.toLowerCase() : resolved;
}

/**
 * Provision (mkdir -p) a profile config dir and return its resolved absolute
 * path. With no customPath, uses the managed location under PROFILES_ROOT.
 * A custom path is expanded (leading ~) and resolved to an absolute path.
 *
 * A path already used by another profile is rejected, regardless of provider:
 * sharing a config tree also shares credentials and transcripts. Re-provisioning
 * the same profile ID and path remains allowed.
 *
 * The check covers the managed path as well as custom ones — a `profileId`
 * that reaches an existing profile's directory only by case or through a
 * symlink is the same collision — and compares canonical forms, so it cannot
 * be bypassed by spelling.
 */
export function provisionProfileDir(
  profileId: string,
  customPath?: string,
  newProviderId?: string,
  existingProfiles: ReadonlyArray<{ id?: string; providerId: string; configDir: string }> = []
): string {
  const trimmed = customPath?.trim();
  const dir = trimmed
    ? path.resolve(trimmed.replace(/^~(?=$|[/\\])/, os.homedir()))
    : managedProfileDir(profileId);

  const target = canonicalDir(dir);
  const collision = existingProfiles.find(
    (p) => p.id !== profileId && canonicalDir(p.configDir) === target
  );
  if (collision) {
    throw new Error(
      `Profile path ${dir} is already used by a ${collision.providerId} profile. ` +
      `Choose a different directory — each profile needs its own config dir.`
    );
  }

  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
