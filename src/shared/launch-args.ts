/**
 * Tokenization of raw "extra args" strings and detection of launch options
 * that conflict with Vibeyard's own session/profile management.
 *
 * The tokenizer defines its own quoting/escaping semantics. It is NOT a
 * shell: no variable expansion, no backticks, no globs, no command
 * substitution.
 *
 * - Delimiters: space, tab, \n, \r.
 * - 'single quotes': literal content, no escapes inside; '' yields an
 *   empty argument.
 * - "double quotes": \" becomes " and \\ becomes \; any other backslash is
 *   kept verbatim.
 * - Unquoted: a backslash escapes only a quote character or another
 *   backslash (\" becomes ", \' becomes ', \\ becomes \); before any other
 *   character it is kept verbatim, so Windows paths like C:\Users\me
 *   survive unquoted. A lone trailing backslash is always kept verbatim.
 * - An unclosed quote consumes the rest of the input as literal; tokenizing
 *   never throws.
 * - Empty arguments are preserved ("" and ''), unlike a naive whitespace
 *   split which drops them.
 */

const DELIMITERS = ' \t\n\r';

export function tokenizeArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let hasToken = false;
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    if (ch === "'") {
      const end = input.indexOf("'", i + 1);
      if (end === -1) {
        // Unclosed single quote: keep the rest of the input literally.
        current += input.slice(i + 1);
        hasToken = true;
        i = n;
      } else {
        current += input.slice(i + 1, end);
        hasToken = true;
        i = end + 1;
      }
    } else if (ch === '"') {
      let j = i + 1;
      let piece = '';
      while (j < n) {
        const c = input[j];
        if (c === '\\' && j + 1 < n && (input[j + 1] === '"' || input[j + 1] === '\\')) {
          piece += input[j + 1];
          j += 2;
        } else if (c === '"') {
          j += 1;
          break;
        } else {
          piece += c;
          j += 1;
        }
      }
      current += piece;
      hasToken = true;
      i = j;
    } else if (ch === '\\' && i + 1 < n && (input[i + 1] === '"' || input[i + 1] === "'" || input[i + 1] === '\\')) {
      current += input[i + 1];
      hasToken = true;
      i += 2;
    } else if (ch === '\\') {
      // Backslash before a non-quote (or at end of input): keep verbatim.
      current += ch;
      hasToken = true;
      i += 1;
    } else if (DELIMITERS.includes(ch)) {
      if (hasToken) {
        args.push(current);
        current = '';
        hasToken = false;
      }
      i += 1;
    } else {
      current += ch;
      hasToken = true;
      i += 1;
    }
  }

  if (hasToken) args.push(current);
  return args;
}

export interface LaunchFlagConflict {
  /** Normalized flag name, e.g. `--profile`. */
  flag: string;
  /** The offending token as written by the user. */
  raw: string;
  /** Why the flag conflicts, for the actionable pre-spawn error. */
  reason: string;
}

/**
 * Launch flags that conflict with Vibeyard's own profile/session management.
 * Vibeyard pins the profile (config dir), owns the session-identity flags
 * and the session storage root; a second source for any of these would make
 * the child process and the transcript readers disagree about which
 * profile/conversation is active.
 */
const CONFLICTING_FLAG_REASONS: Record<string, string> = {
  '--profile': 'Vibeyard pins the profile from the session settings; pick the profile there instead of passing --profile.',
  '--session-dir': "Vibeyard tracks sessions in the profile's default storage; a custom session dir would hide them from history, search and resume.",
  '--no-session': 'Vibeyard needs the session to be persisted to track it; --no-session (ephemeral) is not supported.',
  '--session': 'Vibeyard owns session identity (resume is handled by the session picker); pick the session there instead of passing --session.',
  '--resume': 'Vibeyard owns session identity (resume is handled by the session picker); pick the session there instead of passing --resume.',
  '--continue': 'Vibeyard owns session identity (resume is handled by the session picker); pick the session there instead of passing --continue.',
  '-r': 'Vibeyard owns session identity (resume is handled by the session picker); pick the session there instead of passing -r.',
  '-c': 'Vibeyard owns session identity (resume is handled by the session picker); pick the session there instead of passing -c.',
};

/**
 * Find launch flags that conflict with Vibeyard's own profile/session
 * management. `args` is the tokenized argument vector (see
 * {@link tokenizeArgs}); both value forms (`--profile x` and
 * `--profile=x`) are detected.
 */
export function findConflictingLaunchFlags(args: string[]): LaunchFlagConflict[] {
  const conflicts: LaunchFlagConflict[] = [];
  for (const arg of args) {
    let name = arg;
    if (name.startsWith('--')) {
      const eq = name.indexOf('=');
      if (eq !== -1) name = name.slice(0, eq);
    }
    const reason = CONFLICTING_FLAG_REASONS[name];
    if (reason) conflicts.push({ flag: name, raw: arg, reason });
  }
  return conflicts;
}

/**
 * Environment selectors that point the CLI at a session storage location
 * Vibeyard does not track. Detected in user-provided session env (rejected
 * with an actionable pre-spawn error). Inherited values are stripped by the
 * providers' buildEnv so the child always uses the tracked root.
 */
export const UNSUPPORTED_STORAGE_ENV_KEYS: readonly string[] = [
  'PI_CODING_AGENT_SESSION_DIR',
];

/** Case-insensitive match of env keys against the unsupported storage selectors. */
export function findConflictingEnvKeys(env: Record<string, string>): string[] {
  return Object.keys(env).filter((key) =>
    UNSUPPORTED_STORAGE_ENV_KEYS.includes(key.toUpperCase()),
  );
}
