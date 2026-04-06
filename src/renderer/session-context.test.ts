import {
  setContextData,
  getContext,
  onChange,
  restoreContext,
  removeSession,
  _resetForTesting,
} from './session-context';

beforeEach(() => {
  _resetForTesting();
});

describe('setContextData', () => {
  it('computes usedPercentage correctly', () => {
    setContextData('s1', {
      total_input_tokens: 80_000,
      total_output_tokens: 20_000,
      context_window_tokens: 200_000,
    });

    const ctx = getContext('s1');
    expect(ctx).toEqual({
      totalTokens: 100_000,
      contextWindowSize: 200_000,
      usedPercentage: 50,
    });
  });

  it('uses default context window when not specified', () => {
    setContextData('s1', {
      total_input_tokens: 100_000,
      total_output_tokens: 0,
    });

    const ctx = getContext('s1');
    expect(ctx!.contextWindowSize).toBe(200_000);
    expect(ctx!.usedPercentage).toBe(50);
  });

  it('defaults missing token counts to 0', () => {
    setContextData('s1', {});
    const ctx = getContext('s1');
    expect(ctx!.totalTokens).toBe(0);
    expect(ctx!.usedPercentage).toBe(0);
  });

  it('handles zero context window size without division by zero', () => {
    setContextData('s1', {
      total_input_tokens: 100,
      total_output_tokens: 50,
      context_window_tokens: 0,
    });
    expect(getContext('s1')!.usedPercentage).toBe(0);
  });

  it('notifies listeners', () => {
    const cb = vi.fn();
    onChange(cb);
    setContextData('s1', { total_input_tokens: 100 });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining({ totalTokens: 100 }));
  });
});

describe('getContext', () => {
  it('returns null for unknown session', () => {
    expect(getContext('unknown')).toBeNull();
  });
});

describe('current_usage fields', () => {
  it('computes totalTokens from current_usage when available', () => {
    setContextData('s1', {
      used_percentage: 42,
      current_usage: {
        input_tokens: 10_000,
        cache_creation_input_tokens: 5_000,
        cache_read_input_tokens: 85_000,
      },
    });

    const ctx = getContext('s1');
    expect(ctx!.totalTokens).toBe(100_000);
    expect(ctx!.usedPercentage).toBe(42);
  });

  it('falls back to top-level totals when current_usage is absent', () => {
    setContextData('s1', {
      total_input_tokens: 80_000,
      total_output_tokens: 20_000,
      context_window_size: 200_000,
    });

    const ctx = getContext('s1');
    expect(ctx!.totalTokens).toBe(100_000);
  });

  it('handles undefined contextWindow gracefully', () => {
    setContextData('s1', undefined);
    expect(getContext('s1')).toBeNull();
  });
});

describe('restoreContext', () => {
  it('populates context map from persisted data', () => {
    const info = { totalTokens: 5000, contextWindowSize: 200000, usedPercentage: 2.5 };
    restoreContext('s1', info);
    expect(getContext('s1')).toEqual(info);
  });

  it('is silent (does not notify listeners)', () => {
    const cb = vi.fn();
    onChange(cb);
    restoreContext('s1', { totalTokens: 1000, contextWindowSize: 200000, usedPercentage: 0.5 });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('removeSession', () => {
  it('removes session from map', () => {
    setContextData('s1', { total_input_tokens: 100 });
    removeSession('s1');
    expect(getContext('s1')).toBeNull();
  });
});

describe('onChange unsubscribe', () => {
  it('stops receiving callbacks after unsubscribe', () => {
    const cb = vi.fn();
    const unsub = onChange(cb);

    setContextData('s1', { total_input_tokens: 100 });
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    setContextData('s1', { total_input_tokens: 200 });
    expect(cb).toHaveBeenCalledTimes(1); // no new calls after unsub
  });

  it('only removes the specific subscriber', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = onChange(cb1);
    onChange(cb2);

    unsub1();
    setContextData('s1', { total_input_tokens: 100 });

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});
