/**
 * Minimum Claude Code CLI version at which each hook event was introduced.
 *
 * Source: Claude Code hooks documentation / release notes.
 *
 * Any hook event NOT listed here is treated as unknown and will be skipped
 * during hook installation. When the user's installed CLI version cannot be
 * detected, only hooks with a minVersion of "0.0.0" are considered supported.
 */
export const CLAUDE_HOOK_MIN_VERSIONS: Record<string, string> = {
  PreToolUse: '1.0.38',
  PostToolUse: '1.0.38',
  Notification: '1.0.38',
  Stop: '1.0.38',
  SubagentStop: '1.0.41',
  PreCompact: '1.0.48',
  UserPromptSubmit: '1.0.54',
  SessionStart: '1.0.62',
  SessionEnd: '1.0.85',
  SubagentStart: '2.0.43',
  PermissionRequest: '2.0.45',
  TeammateIdle: '2.1.33',
  TaskCompleted: '2.1.33',
  ConfigChange: '2.1.49',
  WorktreeCreate: '2.1.50',
  WorktreeRemove: '2.1.50',
  InstructionsLoaded: '2.1.69',
  Elicitation: '2.1.76',
  ElicitationResult: '2.1.76',
  PostCompact: '2.1.76',
  StopFailure: '2.1.78',
  CwdChanged: '2.1.83',
  FileChanged: '2.1.83',
  TaskCreated: '2.1.84',
  PermissionDenied: '2.1.89',
  // Earliest version the public changelog references this event in (2.1.119 added
  // `duration_ms` to it). It certainly predates that, but nothing pins how far back,
  // and gating too low would write an unrecognized key into a user's settings.json.
  // Lower the floor if an earlier changelog entry is ever confirmed.
  PostToolUseFailure: '2.1.119',
};

/** Parse a semver-ish string into a [major, minor, patch] tuple, or null. */
export function parseSemver(v: string): [number, number, number] | null {
  const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Return true if `actual` >= `required` (semver compare, patch-level). */
export function semverGte(actual: string, required: string): boolean {
  const a = parseSemver(actual);
  const r = parseSemver(required);
  if (!a || !r) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > r[i]) return true;
    if (a[i] < r[i]) return false;
  }
  return true;
}

/**
 * Compute the set of hook events supported by the given CLI version.
 *
 * If `cliVersion` is null (undetectable), only hooks whose minVersion is
 * "0.0.0" are returned — a safe universal baseline. Currently the manifest
 * has none, so the fallback set is empty and no hooks are installed.
 */
export function getSupportedHookEvents(cliVersion: string | null): Set<string> {
  const supported = new Set<string>();
  for (const [event, minVersion] of Object.entries(CLAUDE_HOOK_MIN_VERSIONS)) {
    if (cliVersion === null) {
      if (minVersion === '0.0.0') supported.add(event);
    } else if (semverGte(cliVersion, minVersion)) {
      supported.add(event);
    }
  }
  return supported;
}
