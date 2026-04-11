import { describe, it, expect } from 'vitest';
import type { CliProviderMeta, SettingsValidationResult } from '../../shared/types.js';
import { hasProviderIssue, type ProviderStatus } from './setup-checks.js';

function makeMeta(overrides: Partial<CliProviderMeta['capabilities']> = {}): CliProviderMeta {
  return {
    id: 'claude',
    displayName: 'Claude Code',
    binaryName: 'claude',
    defaultContextWindowSize: 200_000,
    capabilities: {
      sessionResume: false,
      costTracking: false,
      contextWindow: false,
      hookStatus: false,
      configReading: false,
      shiftEnterNewline: false,
      pendingPromptTrigger: 'session-start',
      ...overrides,
    },
  };
}

function makeValidation(overrides: Partial<SettingsValidationResult> = {}): SettingsValidationResult {
  return {
    statusLine: 'vibeyard',
    hooks: 'complete',
    hookDetails: {},
    ...overrides,
  };
}

function makeStatus(overrides: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    meta: makeMeta(),
    validation: makeValidation(),
    binaryOk: true,
    ...overrides,
  };
}

describe('hasProviderIssue', () => {
  it('returns false when binary is not installed', () => {
    const status = makeStatus({
      meta: makeMeta({ costTracking: true, hookStatus: true }),
      validation: makeValidation({ statusLine: 'missing', hooks: 'missing' }),
      binaryOk: false,
    });
    expect(hasProviderIssue(status)).toBe(false);
  });

  it('returns true when binary installed and statusLine misconfigured with costTracking', () => {
    const status = makeStatus({
      meta: makeMeta({ costTracking: true }),
      validation: makeValidation({ statusLine: 'missing' }),
    });
    expect(hasProviderIssue(status)).toBe(true);
  });

  it('returns true when binary installed and statusLine misconfigured with contextWindow', () => {
    const status = makeStatus({
      meta: makeMeta({ contextWindow: true }),
      validation: makeValidation({ statusLine: 'foreign' }),
    });
    expect(hasProviderIssue(status)).toBe(true);
  });

  it('returns true when binary installed and hooks incomplete', () => {
    const status = makeStatus({
      meta: makeMeta({ hookStatus: true }),
      validation: makeValidation({ hooks: 'partial' }),
    });
    expect(hasProviderIssue(status)).toBe(true);
  });

  it('returns true when binary installed and hooks missing', () => {
    const status = makeStatus({
      meta: makeMeta({ hookStatus: true }),
      validation: makeValidation({ hooks: 'missing' }),
    });
    expect(hasProviderIssue(status)).toBe(true);
  });

  it('returns false when binary installed and everything configured', () => {
    const status = makeStatus({
      meta: makeMeta({ costTracking: true, hookStatus: true }),
      validation: makeValidation({ statusLine: 'vibeyard', hooks: 'complete' }),
    });
    expect(hasProviderIssue(status)).toBe(false);
  });

  it('returns false when statusLine misconfigured but no costTracking/contextWindow capability', () => {
    const status = makeStatus({
      meta: makeMeta({ costTracking: false, contextWindow: false }),
      validation: makeValidation({ statusLine: 'missing' }),
    });
    expect(hasProviderIssue(status)).toBe(false);
  });

  it('returns false when hooks incomplete but no hookStatus capability', () => {
    const status = makeStatus({
      meta: makeMeta({ hookStatus: false }),
      validation: makeValidation({ hooks: 'partial' }),
    });
    expect(hasProviderIssue(status)).toBe(false);
  });
});
