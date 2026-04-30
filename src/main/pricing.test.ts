import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computeCost, normalizeModelKey, _resetForTesting } from './pricing';

describe('normalizeModelKey', () => {
  it('strips trailing -YYYYMMDD date suffix', () => {
    expect(normalizeModelKey('claude-opus-4-7-20260101')).toBe('claude-opus-4-7');
  });

  it('strips trailing [variant] tag', () => {
    expect(normalizeModelKey('claude-opus-4-7[1m]')).toBe('claude-opus-4-7');
  });

  it('lowercases and trims', () => {
    expect(normalizeModelKey('  Claude-Sonnet-4-6  ')).toBe('claude-sonnet-4-6');
  });

  it('leaves unknown shapes untouched (besides case/trim)', () => {
    expect(normalizeModelKey('something-else')).toBe('something-else');
  });
});

describe('computeCost', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it('returns null for unknown model and logs once', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const result = computeCost('mystery-model', { input_tokens: 1000 });
    expect(result).toBeNull();
    // Second call with same unknown model must not log again
    computeCost('mystery-model', { input_tokens: 2000 });
    expect(debugSpy).toHaveBeenCalledTimes(1);
    debugSpy.mockRestore();
  });

  it('computes Sonnet input + output cost', () => {
    // claude-sonnet-4-6: input $3/M, output $15/M
    const cost = computeCost('claude-sonnet-4-6', {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(3 + 15, 6);
  });

  it('computes Opus input + output cost', () => {
    // claude-opus-4-7: input $15/M, output $75/M
    const cost = computeCost('claude-opus-4-7', {
      input_tokens: 100_000,
      output_tokens: 100_000,
    });
    expect(cost).toBeCloseTo(1.5 + 7.5, 6);
  });

  it('computes Haiku input + output cost', () => {
    // claude-haiku-4-5: input $1/M, output $5/M
    const cost = computeCost('claude-haiku-4-5', {
      input_tokens: 500_000,
      output_tokens: 500_000,
    });
    expect(cost).toBeCloseTo(0.5 + 2.5, 6);
  });

  it('cache-read priced separately from input', () => {
    // Sonnet cacheRead $0.30/M
    const cost = computeCost('claude-sonnet-4-6', {
      cache_read_input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.3, 6);
  });

  it('applies 5m and 1h ephemeral cache-write rates separately', () => {
    // Sonnet cacheWrite5m $3.75/M, cacheWrite1h $6/M
    const cost = computeCost('claude-sonnet-4-6', {
      cache_creation: {
        ephemeral_5m_input_tokens: 1_000_000,
        ephemeral_1h_input_tokens: 1_000_000,
      },
    });
    expect(cost).toBeCloseTo(3.75 + 6, 6);
  });

  it('falls back to aggregate cache_creation_input_tokens × 5m rate when ephemeral breakdown absent', () => {
    const cost = computeCost('claude-sonnet-4-6', {
      cache_creation_input_tokens: 2_000_000,
    });
    expect(cost).toBeCloseTo(2 * 3.75, 6);
  });

  it('dated model suffix normalizes to alias and hits the table', () => {
    const cost = computeCost('claude-opus-4-7-20260101', {
      input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(15, 6);
  });

  it('[1m] variant tag normalizes to alias and hits the table', () => {
    const cost = computeCost('claude-opus-4-7[1m]', {
      input_tokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(15, 6);
  });

  it('handles missing usage fields as zero', () => {
    const cost = computeCost('claude-sonnet-4-6', {});
    expect(cost).toBe(0);
  });

  it('skips Claude Code <synthetic> sentinel silently', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const cost = computeCost('<synthetic>', { input_tokens: 1_000_000 });
    expect(cost).toBeNull();
    // Must not log "[pricing] unknown model" — these are internal
    // compaction/system messages, not unknown billable models.
    expect(debugSpy).not.toHaveBeenCalled();
    debugSpy.mockRestore();
  });
});
