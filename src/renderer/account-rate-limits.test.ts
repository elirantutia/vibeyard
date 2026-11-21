import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  setRateLimits, getRateLimits, onChange, formatResetIn, _resetForTesting,
} from './account-rate-limits';

const NOW = 1_800_000_000_000; // epoch ms
const secs = (ms: number) => Math.floor(ms / 1000);

beforeEach(() => {
  _resetForTesting();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('account-rate-limits', () => {
  it('returns windows in display order with epoch-ms reset times', () => {
    setRateLimits('s1', {
      seven_day: { used_percentage: 18, resets_at: secs(NOW + 4 * 86_400_000) },
      five_hour: { used_percentage: 42.4, resets_at: secs(NOW + 3_600_000) },
    });
    const w = getRateLimits('s1');
    expect(w.map((x) => x.key)).toEqual(['five_hour', 'seven_day']);
    expect(w[0].usedPercentage).toBe(42.4);
    expect(w[0].resetsAt).toBe(secs(NOW + 3_600_000) * 1000);
  });

  it('returns nothing for an account without data (API-key login, before any reply)', () => {
    expect(getRateLimits('none')).toEqual([]);
  });

  // Claude omits rate_limits until a session's first API response; a freshly
  // opened tab must not blank its sibling tabs' numbers.
  it('ignores a payload without rate_limits instead of clearing the account', () => {
    const cb = vi.fn();
    setRateLimits('acct', { five_hour: { used_percentage: 42 } });
    onChange(cb);
    setRateLimits('acct', undefined);
    setRateLimits('acct', {});
    expect(cb).not.toHaveBeenCalled();
    expect(getRateLimits('acct').map((x) => x.key)).toEqual(['five_hour']);
  });

  it('keeps accounts apart (work and personal profiles)', () => {
    setRateLimits('', { five_hour: { used_percentage: 10 } });
    setRateLimits('/cfg/work', { five_hour: { used_percentage: 90 } });
    expect(getRateLimits('')[0].usedPercentage).toBe(10);
    expect(getRateLimits('/cfg/work')[0].usedPercentage).toBe(90);
  });

  it('skips windows with no usable percentage', () => {
    setRateLimits('s1', { five_hour: {}, seven_day: { used_percentage: 5 } });
    expect(getRateLimits('s1').map((x) => x.key)).toEqual(['seven_day']);
  });

  it('carries gateway spend dollars when present', () => {
    setRateLimits('s1', { spend_limit: { used_percentage: 54, used_usd: 271.4, limit_usd: 500, period: 'monthly' } });
    expect(getRateLimits('s1')).toEqual([
      { key: 'spend_limit', usedPercentage: 54, resetsAt: undefined, usedUsd: 271.4, limitUsd: 500 },
    ]);
  });

  it('notifies only when the payload changes', () => {
    const cb = vi.fn();
    onChange(cb);
    const rl = { five_hour: { used_percentage: 10, resets_at: secs(NOW + 3_600_000) } };
    setRateLimits('s1', rl);
    setRateLimits('s1', { ...rl });
    expect(cb).toHaveBeenCalledTimes(1);
    setRateLimits('s1', { five_hour: { used_percentage: 11, resets_at: secs(NOW + 3_600_000) } });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  // An idle session's statusLine never re-renders, so the window's expiry
  // must repaint on its own instead of showing a stale percentage forever.
  it('drops a window once it resets and notifies so the pane repaints', () => {
    const cb = vi.fn();
    setRateLimits('s1', {
      five_hour: { used_percentage: 96, resets_at: secs(NOW + 60_000) },
      seven_day: { used_percentage: 20, resets_at: secs(NOW + 86_400_000) },
    });
    onChange(cb);
    vi.advanceTimersByTime(62_000);
    expect(cb).toHaveBeenCalledWith('s1');
    expect(getRateLimits('s1').map((x) => x.key)).toEqual(['seven_day']);
  });

  // setTimeout fires at once past 2^31-1 ms; a monthly spend window is further
  // out than that, which used to spin re-arm → notify → repaint in a tight loop.
  it('does not spin on a reset more than 24.8 days away', () => {
    const cb = vi.fn();
    setRateLimits('gw', { spend_limit: { used_percentage: 54, resets_at: secs(NOW + 28 * 86_400_000) } });
    onChange(cb);
    vi.advanceTimersByTime(60_000);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(28 * 86_400_000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(getRateLimits('gw')).toEqual([]);
  });


  it('formats reset countdowns', () => {
    expect(formatResetIn(NOW + 51 * 60_000, NOW)).toBe('51m');
    expect(formatResetIn(NOW + 134 * 60_000, NOW)).toBe('2h 14m');
    expect(formatResetIn(NOW + (4 * 1440 + 260) * 60_000, NOW)).toBe('4d 4h');
  });
});
