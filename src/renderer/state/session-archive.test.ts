import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../session-cost.js', () => ({
  getCost: vi.fn().mockReturnValue(null),
}));

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

import { buildResumedSessionFromCliId } from './session-archive';

beforeEach(() => {
  uuidCounter = 0;
});

describe('buildResumedSessionFromCliId()', () => {
  it('creates a SessionRecord with the given cliSessionId', () => {
    const session = buildResumedSessionFromCliId('cli-abc-123', 'My Session');
    expect(session.cliSessionId).toBe('cli-abc-123');
    expect(session.name).toBe('My Session');
  });

  it('defaults providerId to claude', () => {
    const session = buildResumedSessionFromCliId('cli-xyz', 'Test');
    expect(session.providerId).toBe('claude');
  });

  it('accepts an explicit providerId', () => {
    const session = buildResumedSessionFromCliId('cli-xyz', 'Test', 'codex');
    expect(session.providerId).toBe('codex');
  });

  it('generates a unique id each call', () => {
    const a = buildResumedSessionFromCliId('cli-1', 'A');
    const b = buildResumedSessionFromCliId('cli-2', 'B');
    expect(a.id).not.toBe(b.id);
  });

  it('sets createdAt to a valid ISO timestamp', () => {
    const before = new Date().toISOString();
    const session = buildResumedSessionFromCliId('cli-t', 'T');
    const after = new Date().toISOString();
    expect(session.createdAt >= before).toBe(true);
    expect(session.createdAt <= after).toBe(true);
  });

  it('does not set type field (plain CLI session)', () => {
    const session = buildResumedSessionFromCliId('cli-t', 'T');
    expect((session as Record<string, unknown>).type).toBeUndefined();
  });
});
