import {
  setCostData,
  parseCost,
  getCost,
  getAggregateCost,
  onChange,
  restoreCost,
  removeSession,
  _resetForTesting,
} from './session-cost';

beforeEach(() => {
  _resetForTesting();
});

describe('setCostData', () => {
  it('stores structured cost data', () => {
    setCostData('s1', {
      cost: { total_cost_usd: 1.5, total_duration_ms: 1000, total_api_duration_ms: 800 },
      context_window: {
        total_input_tokens: 500,
        total_output_tokens: 200,
        current_usage: { cache_read_input_tokens: 100, cache_creation_input_tokens: 50 },
      },
    });

    const cost = getCost('s1');
    expect(cost).toEqual({
      totalCostUsd: 1.5,
      totalInputTokens: 500,
      totalOutputTokens: 200,
      cacheReadTokens: 100,
      cacheCreationTokens: 50,
      totalDurationMs: 1000,
      totalApiDurationMs: 800,
    });
  });

  it('defaults missing fields to 0', () => {
    setCostData('s1', { cost: {}, context_window: {} });

    const cost = getCost('s1');
    expect(cost).toEqual({
      totalCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalDurationMs: 0,
      totalApiDurationMs: 0,
    });
  });

  it('notifies listeners', () => {
    const cb = vi.fn();
    onChange(cb);
    setCostData('s1', { cost: { total_cost_usd: 2.0 }, context_window: {} });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith('s1', expect.objectContaining({ totalCostUsd: 2.0 }));
  });
});

describe('setCostData model tracking', () => {
  it('stores model display name when provided', () => {
    setCostData('s1', {
      cost: { total_cost_usd: 1.0, total_duration_ms: 1000, total_api_duration_ms: 800 },
      context_window: { total_input_tokens: 100, total_output_tokens: 50, current_usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      model: 'Sonnet 4.6',
    });
    expect(getCost('s1')!.model).toBe('Sonnet 4.6');
  });

  it('preserves existing model when subsequent hook omits it', () => {
    setCostData('s1', {
      cost: { total_cost_usd: 1.0, total_duration_ms: 1000, total_api_duration_ms: 800 },
      context_window: { total_input_tokens: 100, total_output_tokens: 50, current_usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      model: 'Sonnet 4.6',
    });
    setCostData('s1', {
      cost: { total_cost_usd: 2.0, total_duration_ms: 2000, total_api_duration_ms: 1600 },
      context_window: { total_input_tokens: 200, total_output_tokens: 100, current_usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
    });
    expect(getCost('s1')!.model).toBe('Sonnet 4.6');
  });

  it('updates model when it changes mid-session', () => {
    setCostData('s1', {
      cost: { total_cost_usd: 1.0, total_duration_ms: 1000, total_api_duration_ms: 800 },
      context_window: { total_input_tokens: 100, total_output_tokens: 50, current_usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      model: 'Sonnet 4.6',
    });
    setCostData('s1', {
      cost: { total_cost_usd: 2.0, total_duration_ms: 2000, total_api_duration_ms: 1600 },
      context_window: { total_input_tokens: 200, total_output_tokens: 100, current_usage: { cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
      model: 'Opus 4.6',
    });
    expect(getCost('s1')!.model).toBe('Opus 4.6');
  });

  it('model is undefined when never provided', () => {
    setCostData('s1', { cost: { total_cost_usd: 1.0 }, context_window: {} });
    expect(getCost('s1')!.model).toBeUndefined();
  });
});

describe('restoreCost model', () => {
  it('restores model from persisted state', () => {
    restoreCost('s1', {
      totalCostUsd: 1.0, totalInputTokens: 100, totalOutputTokens: 50,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalDurationMs: 0, totalApiDurationMs: 0,
      model: 'Sonnet 4.6',
    });
    expect(getCost('s1')!.model).toBe('Sonnet 4.6');
  });
});

describe('parseCost', () => {
  it('extracts last dollar amount from text', () => {
    parseCost('s1', 'Total: $0.50 then $1.23');
    expect(getCost('s1')!.totalCostUsd).toBe(1.23);
  });

  it('strips ANSI before parsing', () => {
    parseCost('s1', '\x1b[32m$0.75\x1b[0m');
    expect(getCost('s1')!.totalCostUsd).toBe(0.75);
  });

  it('does not overwrite structured data with token info', () => {
    setCostData('s1', {
      cost: { total_cost_usd: 5.0 },
      context_window: { total_input_tokens: 100 },
    });
    parseCost('s1', '$0.01');
    expect(getCost('s1')!.totalCostUsd).toBe(5.0);
  });

  it('does nothing when no dollar amount found', () => {
    parseCost('s1', 'no cost here');
    expect(getCost('s1')).toBeNull();
  });

  it('notifies listeners on new cost', () => {
    const cb = vi.fn();
    onChange(cb);
    parseCost('s1', '$1.00');
    expect(cb).toHaveBeenCalledOnce();
  });

  it('does not notify when cost unchanged', () => {
    parseCost('s1', '$1.00');
    const cb = vi.fn();
    onChange(cb);
    parseCost('s1', '$1.00');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('getAggregateCost', () => {
  it('returns zeroes when empty', () => {
    const agg = getAggregateCost();
    expect(agg.totalCostUsd).toBe(0);
    expect(agg.totalInputTokens).toBe(0);
  });

  it('sums across sessions', () => {
    setCostData('s1', { cost: { total_cost_usd: 1.0 }, context_window: { total_input_tokens: 100 } });
    setCostData('s2', { cost: { total_cost_usd: 2.0 }, context_window: { total_input_tokens: 200 } });

    const agg = getAggregateCost();
    expect(agg.totalCostUsd).toBe(3.0);
    expect(agg.totalInputTokens).toBe(300);
  });

  it('reflects removal', () => {
    setCostData('s1', { cost: { total_cost_usd: 1.0 }, context_window: {} });
    setCostData('s2', { cost: { total_cost_usd: 2.0 }, context_window: {} });
    removeSession('s1');

    expect(getAggregateCost().totalCostUsd).toBe(2.0);
  });
});

describe('getCost', () => {
  it('returns null for unknown session', () => {
    expect(getCost('unknown')).toBeNull();
  });
});

describe('restoreCost', () => {
  it('populates cost map from persisted data', () => {
    const cost = {
      totalCostUsd: 3.0,
      totalInputTokens: 800,
      totalOutputTokens: 300,
      cacheReadTokens: 50,
      cacheCreationTokens: 20,
      totalDurationMs: 2000,
      totalApiDurationMs: 1500,
    };
    restoreCost('s1', cost);
    expect(getCost('s1')).toEqual(cost);
  });

  it('is silent (does not notify listeners)', () => {
    const cb = vi.fn();
    onChange(cb);
    restoreCost('s1', {
      totalCostUsd: 1.0, totalInputTokens: 0, totalOutputTokens: 0,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalDurationMs: 0, totalApiDurationMs: 0,
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('contributes to aggregate cost', () => {
    restoreCost('s1', {
      totalCostUsd: 1.0, totalInputTokens: 100, totalOutputTokens: 50,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalDurationMs: 0, totalApiDurationMs: 0,
    });
    restoreCost('s2', {
      totalCostUsd: 2.0, totalInputTokens: 200, totalOutputTokens: 100,
      cacheReadTokens: 0, cacheCreationTokens: 0, totalDurationMs: 0, totalApiDurationMs: 0,
    });
    const agg = getAggregateCost();
    expect(agg.totalCostUsd).toBe(3.0);
    expect(agg.totalInputTokens).toBe(300);
  });
});

describe('removeSession', () => {
  it('removes session from map', () => {
    setCostData('s1', { cost: { total_cost_usd: 1.0 }, context_window: {} });
    removeSession('s1');
    expect(getCost('s1')).toBeNull();
  });
});
