/**
 * Shared parsing for user-provided environment variables entered as raw
 * `KEY=VALUE` text (one pair per line). Used by the main process to build the
 * PTY environment and by the renderer to validate input before spawning, so
 * both agree on exactly which lines are kept and which are rejected.
 */

/** A non-blank line is valid when it has a `=` with at least one char before it. */
function splitEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx <= 0) return null;
  return { key: trimmed.slice(0, eqIdx).trim(), value: trimmed.slice(eqIdx + 1) };
}

/**
 * Parse raw `KEY=VALUE` text into an env map. The value is taken after the
 * first `=` only (so values may contain `=`); the surrounding line is trimmed,
 * which also strips a stray trailing `\r` from CRLF input. Blank lines and
 * lines without a valid `KEY=` are skipped — parsing never throws so a spawn is
 * never blocked by malformed input (the renderer surfaces those via
 * {@link findInvalidEnvLines}).
 */
export function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!text) return env;
  for (const line of text.split('\n')) {
    const parsed = splitEnvLine(line);
    if (parsed) env[parsed.key] = parsed.value;
  }
  return env;
}

/**
 * Return each non-blank line that is NOT a valid `KEY=VALUE` pair (missing `=`
 * or an empty key), so the UI can reject the input before spawning. Mirrors the
 * skip rule in {@link parseEnvVars} so what is rejected is exactly what would be
 * silently lost.
 */
export function findInvalidEnvLines(text: string): string[] {
  const invalid: string[] = [];
  if (!text) return invalid;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!splitEnvLine(line)) invalid.push(trimmed);
  }
  return invalid;
}

/**
 * Environment variables owned by a provider's profile isolation rather than by
 * the user.
 *
 * `CLAUDE_CONFIG_DIR`, `PI_CODING_AGENT_DIR` and `PI_CONFIG_DIR` relocate a
 * CLI's entire config tree, `PI_PROFILE` and `OMP_PROFILE` select a native
 * profile (the Pi/OMP resolvers honor them over any relocated dir), and
 * `CLAUDE_IDE_SESSION_ID` keys the per-session status files that the
 * hooks and the statusLine write. Allowing a session's own `envVars` to
 * override any of these would silently point that session at a different
 * login's config, or make it write status under another session's key —
 * defeating the pinned profile with no visible signal.
 *
 * `PATH` is deliberately NOT listed: overriding it is a supported use case
 * ("user vars win").
 */
export const PROVIDER_OWNED_ENV_KEYS: readonly string[] = [
  'CLAUDE_CONFIG_DIR',
  'PI_CODING_AGENT_DIR',
  'PI_CONFIG_DIR',
  'PI_PROFILE',
  'OMP_PROFILE',
  'CLAUDE_IDE_SESSION_ID',
];

/** Windows environment names are case-insensitive even when object keys are not. */
export function removeEnvKey(env: Record<string, string>, name: string): void {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === name) delete env[key];
  }
}

/**
 * Split parsed user env into the part that may be merged over the provider's
 * environment and the provider-owned keys that must not be, so the caller can
 * report what was dropped instead of losing it silently.
 */
export function partitionUserEnv(env: Record<string, string>): {
  allowed: Record<string, string>;
  dropped: string[];
} {
  const allowed: Record<string, string> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (PROVIDER_OWNED_ENV_KEYS.includes(key.toUpperCase())) {
      dropped.push(key);
    } else {
      allowed[key] = value;
    }
  }
  return { allowed, dropped };
}
