import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/** Root directory holding all auto-managed profile config dirs. */
export const PROFILES_ROOT = path.join(os.homedir(), '.vibeyard', 'profiles');

/** Default managed config dir for a profile id. */
export function managedProfileDir(profileId: string): string {
  return path.join(PROFILES_ROOT, profileId);
}

/**
 * Provision (mkdir -p) a profile config dir and return its resolved absolute
 * path. With no customPath, uses the managed location under PROFILES_ROOT.
 * A custom path is expanded (leading ~) and resolved to an absolute path.
 */
export function provisionProfileDir(profileId: string, customPath?: string): string {
  const trimmed = customPath?.trim();
  const dir = trimmed
    ? path.resolve(trimmed.replace(/^~(?=$|[/\\])/, os.homedir()))
    : managedProfileDir(profileId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
