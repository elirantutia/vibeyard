import { describe, it, expect, beforeEach } from 'vitest';
import { issueCtlToken, revokeCtlToken, resolveCtlToken, stripInheritedCtlEnv, _resetCtlTokensForTesting } from './ctl-tokens';

beforeEach(() => _resetCtlTokensForTesting());

describe('ctl tokens', () => {
  it('maps a token back to its session', () => {
    const t = issueCtlToken('s1');
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(resolveCtlToken(t)).toBe('s1');
  });

  it('respawn invalidates the old token (never resolves to any session)', () => {
    const old = issueCtlToken('s1');
    const fresh = issueCtlToken('s1');
    expect(fresh).not.toBe(old);
    expect(resolveCtlToken(old)).toBeUndefined();
    expect(resolveCtlToken(fresh)).toBe('s1');
  });

  it('revoke on exit invalidates the token', () => {
    const t = issueCtlToken('s1');
    revokeCtlToken('s1');
    expect(resolveCtlToken(t)).toBeUndefined();
  });

  it('unknown and empty tokens resolve to nothing', () => {
    issueCtlToken('s1');
    expect(resolveCtlToken('')).toBeUndefined();
    expect(resolveCtlToken('deadbeef')).toBeUndefined();
  });
});

describe('stripInheritedCtlEnv', () => {
  it('removes a parent tab\'s VIBEYARD_CTL and VIBEYARD_CTL_TOKEN, leaving everything else', () => {
    const env: NodeJS.ProcessEnv = { VIBEYARD_CTL: '/x/vibeyard-ctl', VIBEYARD_CTL_TOKEN: 'parent', VIBEYARD_CTL_TIMEOUT: '5', PATH: '/bin' };
    stripInheritedCtlEnv(env);
    expect(env).toEqual({ VIBEYARD_CTL_TIMEOUT: '5', PATH: '/bin' });
  });

  it('is a no-op when nothing was inherited', () => {
    const env: NodeJS.ProcessEnv = { HOME: '/h' };
    stripInheritedCtlEnv(env);
    expect(env).toEqual({ HOME: '/h' });
  });
});
