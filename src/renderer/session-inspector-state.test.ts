import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { InspectorEvent } from '../shared/types';
import {
  addEvents,
  getEvents,
  getToolStats,
  getContextHistory,
  getCostDeltas,
  onChange,
  clearSession,
  _resetForTesting,
} from './session-inspector-state.js';

function makeEvent(partial: Partial<InspectorEvent> & { type: InspectorEvent['type'] }): InspectorEvent {
  return {
    timestamp: 0,
    hookEvent: 'test',
    ...partial,
  };
}

describe('session-inspector-state', () => {
  beforeEach(() => {
    _resetForTesting();
  });

  describe('addEvents / getEvents', () => {
    it('returns empty array for unknown session', () => {
      expect(getEvents('nope')).toEqual([]);
    });

    it('appends events and retrieves them', () => {
      addEvents('s1', [makeEvent({ type: 'user_prompt', timestamp: 1 })]);
      addEvents('s1', [makeEvent({ type: 'tool_use', timestamp: 2 })]);
      const events = getEvents('s1');
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('user_prompt');
      expect(events[1].type).toBe('tool_use');
    });

    it('caps events at MAX_EVENTS (2000), dropping oldest', () => {
      const batch: InspectorEvent[] = [];
      for (let i = 0; i < 2050; i++) {
        batch.push(makeEvent({ type: 'tool_use', timestamp: i }));
      }
      addEvents('s1', batch);
      const events = getEvents('s1');
      expect(events).toHaveLength(2000);
      // Oldest 50 dropped, so first is timestamp 50
      expect(events[0].timestamp).toBe(50);
      expect(events[1999].timestamp).toBe(2049);
    });

    it('notifies listeners on addEvents', () => {
      const cb = vi.fn();
      onChange(cb);
      addEvents('s1', [makeEvent({ type: 'user_prompt' })]);
      expect(cb).toHaveBeenCalledWith('s1');
    });

    it('invalidates cost delta cache when events change', () => {
      addEvents('s1', [
        makeEvent({ type: 'tool_use', cost_snapshot: { total_cost_usd: 0.1, total_duration_ms: 100 } }),
      ]);
      const first = getCostDeltas('s1');
      expect(first).toHaveLength(1);
      addEvents('s1', [
        makeEvent({ type: 'tool_use', cost_snapshot: { total_cost_usd: 0.3, total_duration_ms: 100 } }),
      ]);
      const second = getCostDeltas('s1');
      expect(second).toHaveLength(2);
      // second delta should be 0.3 - 0.1 = 0.2
      expect(second[1].delta).toBeCloseTo(0.2, 5);
    });
  });

  describe('getToolStats', () => {
    it('returns empty array for unknown session', () => {
      expect(getToolStats('nope')).toEqual([]);
    });

    it('aggregates call counts, failures, and totalCost per tool', () => {
      addEvents('s1', [
        makeEvent({
          type: 'tool_use',
          tool_name: 'Bash',
          cost_snapshot: { total_cost_usd: 0.1, total_duration_ms: 10 },
        }),
        makeEvent({
          type: 'tool_use',
          tool_name: 'Bash',
          cost_snapshot: { total_cost_usd: 0.25, total_duration_ms: 10 },
        }),
        makeEvent({
          type: 'tool_failure',
          tool_name: 'Bash',
          cost_snapshot: { total_cost_usd: 0.3, total_duration_ms: 10 },
        }),
        makeEvent({
          type: 'tool_use',
          tool_name: 'Read',
          cost_snapshot: { total_cost_usd: 0.35, total_duration_ms: 10 },
        }),
      ]);

      const stats = getToolStats('s1');
      // sorted desc by calls
      expect(stats[0].tool_name).toBe('Bash');
      expect(stats[0].calls).toBe(3);
      expect(stats[0].failures).toBe(1);
      expect(stats[0].totalCost).toBeCloseTo(0.1 + 0.15 + 0.05, 5);
      expect(stats[1].tool_name).toBe('Read');
      expect(stats[1].calls).toBe(1);
      expect(stats[1].failures).toBe(0);
    });

    it('uses "unknown" when tool_name is missing', () => {
      addEvents('s1', [makeEvent({ type: 'tool_use' })]);
      const stats = getToolStats('s1');
      expect(stats[0].tool_name).toBe('unknown');
    });

    it('skips non-tool events', () => {
      addEvents('s1', [
        makeEvent({ type: 'user_prompt' }),
        makeEvent({ type: 'session_start' }),
      ]);
      expect(getToolStats('s1')).toEqual([]);
    });
  });

  describe('getContextHistory', () => {
    it('returns empty array for unknown session', () => {
      expect(getContextHistory('nope')).toEqual([]);
    });

    it('extracts context snapshots with the right shape', () => {
      addEvents('s1', [
        makeEvent({ type: 'user_prompt', timestamp: 10 }),
        makeEvent({
          type: 'tool_use',
          timestamp: 20,
          context_snapshot: { total_tokens: 1000, context_window_size: 200000, used_percentage: 0.5 },
        }),
        makeEvent({
          type: 'tool_use',
          timestamp: 30,
          context_snapshot: { total_tokens: 2000, context_window_size: 200000, used_percentage: 1.0 },
        }),
      ]);
      const history = getContextHistory('s1');
      expect(history).toEqual([
        { timestamp: 20, usedPercentage: 0.5, totalTokens: 1000 },
        { timestamp: 30, usedPercentage: 1.0, totalTokens: 2000 },
      ]);
    });
  });

  describe('getCostDeltas', () => {
    it('returns empty array for unknown session', () => {
      expect(getCostDeltas('nope')).toEqual([]);
    });

    it('computes first snapshot as absolute, subsequent as differences', () => {
      addEvents('s1', [
        makeEvent({ type: 'user_prompt' }), // no cost
        makeEvent({ type: 'tool_use', cost_snapshot: { total_cost_usd: 0.1, total_duration_ms: 10 } }),
        makeEvent({ type: 'tool_use' }), // no cost
        makeEvent({ type: 'tool_use', cost_snapshot: { total_cost_usd: 0.35, total_duration_ms: 10 } }),
      ]);
      const deltas = getCostDeltas('s1');
      expect(deltas).toHaveLength(2);
      expect(deltas[0]).toEqual({ index: 1, delta: 0.1 });
      expect(deltas[1].index).toBe(3);
      expect(deltas[1].delta).toBeCloseTo(0.25, 5);
    });

    it('reuses cached deltas when event count has not changed', () => {
      addEvents('s1', [
        makeEvent({ type: 'tool_use', cost_snapshot: { total_cost_usd: 0.1, total_duration_ms: 10 } }),
      ]);
      const first = getCostDeltas('s1');
      const second = getCostDeltas('s1');
      expect(second).toBe(first); // identity — cache hit
    });
  });

  describe('clearSession', () => {
    it('removes events and cost cache for a session', () => {
      addEvents('s1', [
        makeEvent({ type: 'tool_use', cost_snapshot: { total_cost_usd: 0.1, total_duration_ms: 10 } }),
      ]);
      getCostDeltas('s1'); // prime cache
      clearSession('s1');
      expect(getEvents('s1')).toEqual([]);
      expect(getCostDeltas('s1')).toEqual([]);
    });

    it('is a no-op for unknown sessions', () => {
      expect(() => clearSession('nope')).not.toThrow();
    });
  });

  describe('onChange', () => {
    it('fires all registered listeners', () => {
      const a = vi.fn();
      const b = vi.fn();
      onChange(a);
      onChange(b);
      addEvents('s1', [makeEvent({ type: 'user_prompt' })]);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
    });
  });

  describe('_resetForTesting', () => {
    it('clears events, cache, and listeners', () => {
      const cb = vi.fn();
      onChange(cb);
      addEvents('s1', [makeEvent({ type: 'user_prompt' })]);
      _resetForTesting();
      addEvents('s1', [makeEvent({ type: 'user_prompt' })]);
      // cb was cleared by reset, so it should only have been called once (before reset)
      expect(cb).toHaveBeenCalledTimes(1);
      expect(getEvents('s1')).toHaveLength(1); // from the post-reset add
    });
  });
});
