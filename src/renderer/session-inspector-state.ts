import type { InspectorEvent, ToolUsageStats, ContextDataPoint } from '../shared/types';

type ChangeCallback = (sessionId: string) => void;

const MAX_EVENTS = 2000;
const sessionEvents = new Map<string, InspectorEvent[]>();
const listeners: ChangeCallback[] = [];

// Cached cost deltas, invalidated when events change
const costDeltaCache = new Map<string, { length: number; deltas: { index: number; delta: number }[] }>();

export function addEvents(sessionId: string, events: InspectorEvent[]): void {
  const existing = sessionEvents.get(sessionId) ?? [];
  existing.push(...events);
  // Cap at MAX_EVENTS, drop oldest
  if (existing.length > MAX_EVENTS) {
    existing.splice(0, existing.length - MAX_EVENTS);
  }
  sessionEvents.set(sessionId, existing);
  // Invalidate cache when events change
  costDeltaCache.delete(sessionId);
  for (const cb of listeners) cb(sessionId);
}

export function getEvents(sessionId: string): InspectorEvent[] {
  return sessionEvents.get(sessionId) ?? [];
}

export function getToolStats(sessionId: string): ToolUsageStats[] {
  const events = sessionEvents.get(sessionId) ?? [];
  const statsMap = new Map<string, ToolUsageStats>();

  // Use cached deltas for O(1) lookup instead of O(n) backward scan per event
  const deltaMap = new Map(getCostDeltas(sessionId).map(d => [d.index, d.delta]));

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.type !== 'tool_use' && ev.type !== 'tool_failure') continue;
    const name = ev.tool_name ?? 'unknown';
    let stats = statsMap.get(name);
    if (!stats) {
      stats = { tool_name: name, calls: 0, failures: 0, totalCost: 0 };
      statsMap.set(name, stats);
    }
    stats.calls++;
    if (ev.type === 'tool_failure') stats.failures++;

    const delta = deltaMap.get(i);
    if (delta !== undefined) {
      stats.totalCost += delta;
    }
  }

  return Array.from(statsMap.values()).sort((a, b) => b.calls - a.calls);
}

export function getContextHistory(sessionId: string): ContextDataPoint[] {
  const events = sessionEvents.get(sessionId) ?? [];
  const points: ContextDataPoint[] = [];
  for (const ev of events) {
    if (ev.context_snapshot) {
      points.push({
        timestamp: ev.timestamp,
        usedPercentage: ev.context_snapshot.used_percentage,
        totalTokens: ev.context_snapshot.total_tokens,
      });
    }
  }
  return points;
}

/**
 * Compute cost deltas in a single forward pass (O(n)).
 * Results are cached per session and invalidated when new events arrive.
 */
export function getCostDeltas(sessionId: string): { index: number; delta: number }[] {
  const events = sessionEvents.get(sessionId) ?? [];

  // Return cached result if events haven't changed
  const cached = costDeltaCache.get(sessionId);
  if (cached && cached.length === events.length) {
    return cached.deltas;
  }

  const deltas: { index: number; delta: number }[] = [];
  let prevCost: number | null = null;

  for (let i = 0; i < events.length; i++) {
    const snapshot = events[i].cost_snapshot;
    if (snapshot) {
      const delta = prevCost !== null
        ? snapshot.total_cost_usd - prevCost
        : snapshot.total_cost_usd;
      deltas.push({ index: i, delta });
      prevCost = snapshot.total_cost_usd;
    }
  }

  costDeltaCache.set(sessionId, { length: events.length, deltas });
  return deltas;
}

export function onChange(callback: ChangeCallback): void {
  listeners.push(callback);
}

export function clearSession(sessionId: string): void {
  sessionEvents.delete(sessionId);
  costDeltaCache.delete(sessionId);
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  sessionEvents.clear();
  costDeltaCache.clear();
  listeners.length = 0;
}
