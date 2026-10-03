import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { loadState } from './store';

/**
 * Per-launch session storage for the Pi-compatible CLIs (Pi and OMP).
 *
 * Every Pi/OMP launch gets a directory of its own; the CLI is pointed at it
 * with `--session-dir`, so the transcripts a launch produces can ONLY appear
 * in that directory. That directory is the process-scoped ownership signal
 * the sessions watcher adopts by: a file in the directory belongs to the
 * session that owns the directory — no cwd matching, no timestamp freshness
 * window, no cross-tab ambiguity.
 *
 * The directory is derived from the UI session id (deterministic), so it
 * survives a restart without any persisted mapping: a resumed tab recomputes
 * the same directory and finds its own transcripts there. A sidecar
 * (`.vibeyard.json`) records the launch's profile/cwd so global session
 * search can surface these transcripts with the right profile.
 *
 * Legacy transcripts (default agent dir, profile trees, external CLI runs)
 * stay exactly where they are — nothing is moved or deleted; discovery
 * covers both locations.
 */

export type LaunchSessionProvider = 'pi' | 'omp';

/** A UI session id becomes a directory name; it must not escape the base dir. */
const UI_SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Base directory holding every per-launch session dir for one provider. */
export function launchSessionBaseDir(providerId: LaunchSessionProvider): string {
  return path.join(app.getPath('userData'), providerId === 'pi' ? 'pi-sessions' : 'omp-sessions');
}

/**
 * The exclusive per-launch session dir for one UI session. Unsafe id
 * characters are sanitized (never thrown — a weird id must not break a
 * spawn); the result is always inside the provider's base dir.
 */
export function launchSessionDir(providerId: LaunchSessionProvider, uiSessionId: string): string {
  const safe = UI_SESSION_ID_RE.test(uiSessionId)
    ? uiSessionId
    : (uiSessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128) || 'session');
  return path.join(launchSessionBaseDir(providerId), safe);
}

/** Create the per-launch dir (and its base) so the CLI never races us. */
export function ensureLaunchSessionDir(sessionDir: string): void {
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
  } catch {
    // The CLI creates the dir on its first write; the watcher tolerates a
    // missing dir (empty listing) until it appears.
  }
}

export interface LaunchSessionMeta {
  providerId: LaunchSessionProvider;
  /** Project cwd the launch ran in. */
  cwd: string;
  /** Pinned profile config dir; undefined = the provider's default agent dir. */
  configDir?: string;
  createdAt: string;
}

const META_FILENAME = '.vibeyard.json';

/** Record the launch's identity next to its transcripts (best-effort). */
export function writeLaunchSessionMeta(sessionDir: string, meta: LaunchSessionMeta): void {
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, META_FILENAME), JSON.stringify(meta));
  } catch {
    // Without the sidecar, global search shows these transcripts under the
    // default profile — degraded, not broken.
  }
}

/** Read a per-launch dir's sidecar; null when absent or malformed. */
export function readLaunchSessionMeta(sessionDir: string): LaunchSessionMeta | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(sessionDir, META_FILENAME), 'utf-8'));
    if (typeof raw?.cwd !== 'string' || !raw.cwd) return null;
    return {
      providerId: raw.providerId === 'omp' ? 'omp' : 'pi',
      cwd: raw.cwd,
      configDir: typeof raw.configDir === 'string' && raw.configDir ? raw.configDir : undefined,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

/** Every per-launch session dir under the provider's base dir. */
export function listLaunchSessionDirs(base: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(base);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of names) {
    try {
      if (fs.statSync(path.join(base, name)).isDirectory()) out.push(path.join(base, name));
    } catch {
      // Vanished between readdir and stat — skip.
    }
  }
  return out;
}

/**
 * The profile id a config dir belongs to (for search descriptors), so a
 * transcript found in a per-launch dir resumes against the right login.
 * undefined = the default agent dir (or an unknown dir — never a guess).
 */
export function profileIdForConfigDir(providerId: LaunchSessionProvider, configDir: string | undefined): string | undefined {
  if (!configDir) return undefined;
  const resolved = path.resolve(configDir);
  try {
    for (const profile of loadState().profiles ?? []) {
      if (profile.providerId === providerId && path.resolve(profile.configDir) === resolved) {
        return profile.id;
      }
    }
  } catch {
    // Profiles unavailable — default profile.
  }
  return undefined;
}
