import { describe, it, expect } from 'vitest';
import { buildCliSession } from './session-factory';

describe('buildCliSession', () => {
  it('omits args and envVars when not provided', () => {
    const session = buildCliSession({ name: 'S1', providerId: 'claude' });
    expect(session.name).toBe('S1');
    expect(session.providerId).toBe('claude');
    expect('args' in session).toBe(false);
    expect('envVars' in session).toBe(false);
    expect(session.cliSessionId).toBeNull();
  });

  it('includes args when provided', () => {
    const session = buildCliSession({ name: 'S1', providerId: 'claude', args: '--model sonnet' });
    expect(session.args).toBe('--model sonnet');
  });

  it('includes envVars when provided', () => {
    const session = buildCliSession({ name: 'S1', providerId: 'claude', envVars: 'FOO=bar' });
    expect(session.envVars).toBe('FOO=bar');
  });

  it('includes both args and envVars when both provided', () => {
    const session = buildCliSession({
      name: 'S1',
      providerId: 'claude',
      args: '--verbose',
      envVars: 'FOO=bar\nBAZ=qux',
    });
    expect(session.args).toBe('--verbose');
    expect(session.envVars).toBe('FOO=bar\nBAZ=qux');
  });

  it('omits envVars for an empty string', () => {
    const session = buildCliSession({ name: 'S1', providerId: 'claude', envVars: '' });
    expect('envVars' in session).toBe(false);
  });
});
