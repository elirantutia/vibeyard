import { describe, it, expect } from 'vitest';
import { bigInitialContext } from './big-initial-context.js';
import type { InitialContextSnapshot } from '../../shared/types.js';

function makeSnapshot(usedPercentage: number, totalTokens = 30000, contextWindowSize = 200000): InitialContextSnapshot {
  return {
    sessionId: 'test-session',
    timestamp: new Date().toISOString(),
    totalTokens,
    contextWindowSize,
    usedPercentage,
  };
}

describe('bigInitialContext analyzer', () => {
  it('returns empty array when below threshold', () => {
    expect(bigInitialContext.analyze(makeSnapshot(10))).toEqual([]);
    expect(bigInitialContext.analyze(makeSnapshot(0))).toEqual([]);
    expect(bigInitialContext.analyze(makeSnapshot(14.9))).toEqual([]);
  });

  it('returns warning at exactly 15%', () => {
    const results = bigInitialContext.analyze(makeSnapshot(15));
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('big-initial-context');
    expect(results[0].severity).toBe('warning');
    expect(results[0].description).toContain('15%');
  });

  it('returns warning above 15%', () => {
    const results = bigInitialContext.analyze(makeSnapshot(25, 50000));
    expect(results).toHaveLength(1);
    expect(results[0].description).toContain('25%');
    expect(results[0].description).toContain((50000).toLocaleString());
  });

  it('returns warning at high percentages', () => {
    const results = bigInitialContext.analyze(makeSnapshot(80, 160000));
    expect(results).toHaveLength(1);
    expect(results[0].description).toContain('80%');
  });

  it('rounds fractional percentages in description', () => {
    const results = bigInitialContext.analyze(makeSnapshot(15.7));
    expect(results[0].description).toContain('16%');
  });

  it('includes metric field with percentage', () => {
    const results = bigInitialContext.analyze(makeSnapshot(20));
    expect(results[0].metric).toBe('20%');
  });

  it('includes a non-empty title', () => {
    const results = bigInitialContext.analyze(makeSnapshot(20));
    expect(results[0].title).toBeTruthy();
    expect(typeof results[0].title).toBe('string');
  });

  it('returns exactly one result per call when above threshold', () => {
    const results = bigInitialContext.analyze(makeSnapshot(99, 198000));
    expect(results).toHaveLength(1);
  });

  it('has the correct analyzer id', () => {
    expect(bigInitialContext.id).toBe('big-initial-context');
  });

  it('mentions impact on response quality in the description', () => {
    const results = bigInitialContext.analyze(makeSnapshot(30));
    expect(results[0].description).toMatch(/response quality|cost efficiency/);
  });
});
