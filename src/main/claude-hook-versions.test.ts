import { describe, it, expect } from 'vitest';
import { CLAUDE_HOOK_MIN_VERSIONS, getSupportedHookEvents, parseSemver, semverGte } from './claude-hook-versions';

describe('CLAUDE_HOOK_MIN_VERSIONS', () => {
  it('lists a parseable semver for every event', () => {
    for (const [event, min] of Object.entries(CLAUDE_HOOK_MIN_VERSIONS)) {
      expect(parseSemver(min), `${event} -> ${min}`).not.toBeNull();
    }
  });
});

describe('getSupportedHookEvents', () => {
  // An undetectable CLI must install nothing rather than guess — writing an
  // unrecognized hook key into a user's settings.json is the failure mode this
  // manifest exists to prevent.
  it('supports nothing when the version cannot be detected', () => {
    expect(getSupportedHookEvents(null).size).toBe(0);
  });

  it('supports every known event on a current CLI', () => {
    const supported = getSupportedHookEvents('2.1.238');
    for (const event of Object.keys(CLAUDE_HOOK_MIN_VERSIONS)) {
      expect(supported.has(event), event).toBe(true);
    }
  });

  it('gates each event at its own minimum version', () => {
    // One patch below PostToolUseFailure's floor: everything older is in, it is out.
    const supported = getSupportedHookEvents('2.1.118');
    expect(supported.has('PostToolUseFailure')).toBe(false);
    expect(supported.has('PermissionDenied')).toBe(true); // 2.1.89
    expect(supported.has('Stop')).toBe(true); // 1.0.38
  });

  it('excludes events newer than the running CLI', () => {
    const supported = getSupportedHookEvents('1.0.40');
    expect(supported.has('Stop')).toBe(true); // 1.0.38
    expect(supported.has('SubagentStop')).toBe(false); // 1.0.41
  });

  it('treats an unparseable version as unsupported rather than newest', () => {
    expect(semverGte('not-a-version', '1.0.0')).toBe(false);
    expect(getSupportedHookEvents('not-a-version').size).toBe(0);
  });
});
