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
