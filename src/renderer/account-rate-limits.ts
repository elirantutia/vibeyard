import type { RateLimitsData, RateLimitWindow } from '../shared/types';

/**
 * Plan usage limits (Claude statusLine `rate_limits`), keyed by **account**.
 *
 * The windows belong to the login, not the session, so every tab on the same
 * profile must show the same numbers: whichever tab's statusLine reported last
 * wins, and every pane on that account repaints. The key is the profile's
 * config dir (`''` for the default `~/.claude`), the same value the PTY was
 * spawned with, so it can never disagree with the login the session uses.
 *
 * A payload WITHOUT `rate_limits` is ignored rather than clearing the account:
 * Claude omits the key until a session's first API response, so a freshly
 * opened tab would otherwise blank every sibling tab's numbers.
 *
 * Not persisted: the data is only meaningful until its `resets_at`. A window
 * past that is dropped on read, and an expiry timer notifies listeners so idle
 * panes (whose statusLine never re-renders) repaint on their own.
 */

export type LimitKey = 'five_hour' | 'seven_day' | 'spend_limit';

export interface LimitWindow {
  key: LimitKey;
  usedPercentage: number;
  /** Epoch ms, when known. */
  resetsAt?: number;
  usedUsd?: number;
  limitUsd?: number;
}

type ChangeCallback = (accountKey: string) => void;

/** `blob` is the serialized payload, kept to skip notifying on an unchanged report. */
const limits = new Map<string, { raw: RateLimitsData; blob: string }>();
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners: ChangeCallback[] = [];

const KEYS: LimitKey[] = ['five_hour', 'seven_day', 'spend_limit'];

/** setTimeout fires immediately past 2^31-1 ms (~24.8 days); a monthly spend window can be further out. */
const MAX_TIMER_MS = 2 ** 31 - 1;

function notify(accountKey: string): void {
  for (const cb of listeners) cb(accountKey);
}

function armExpiry(accountKey: string, now: number): void {
  const prev = expiryTimers.get(accountKey);
  if (prev !== undefined) clearTimeout(prev);
  expiryTimers.delete(accountKey);
  const next = Math.min(...getRateLimits(accountKey, now).map((w) => w.resetsAt ?? Infinity));
  if (!Number.isFinite(next)) return;
  expiryTimers.set(accountKey, setTimeout(() => {
    expiryTimers.delete(accountKey);
    const at = Date.now();
    armExpiry(accountKey, at);
    // A clamped (far-future) timer re-arms without anything having expired.
    if (at >= next) notify(accountKey);
  }, Math.min(MAX_TIMER_MS, Math.max(0, next - now) + 1000)));
}

/** Record an account's latest `rate_limits`. Absent data is ignored; notifies only on change. */
export function setRateLimits(accountKey: string, raw: RateLimitsData | undefined, now = Date.now()): void {
  if (!raw || typeof raw !== 'object') return;
  const blob = JSON.stringify(raw);
  if (blob === '{}' || limits.get(accountKey)?.blob === blob) return;
  limits.set(accountKey, { raw, blob });
  armExpiry(accountKey, now);
  notify(accountKey);
}

function toWindow(key: LimitKey, w: RateLimitWindow | undefined, now: number): LimitWindow | null {
  if (!w || typeof w.used_percentage !== 'number' || !Number.isFinite(w.used_percentage)) return null;
  const resetsAt = typeof w.resets_at === 'number' ? w.resets_at * 1000 : undefined;
  if (resetsAt !== undefined && resetsAt <= now) return null;
  const out: LimitWindow = { key, usedPercentage: Math.max(0, Math.min(100, w.used_percentage)), resetsAt };
  if (key === 'spend_limit') {
    const s = w as NonNullable<RateLimitsData['spend_limit']>;
    if (typeof s.used_usd === 'number') out.usedUsd = s.used_usd;
    if (typeof s.limit_usd === 'number') out.limitUsd = s.limit_usd;
  }
  return out;
}

/** The account's live (non-expired) windows, in display order. Empty when there is no data. */
export function getRateLimits(accountKey: string, now = Date.now()): LimitWindow[] {
  const raw = limits.get(accountKey)?.raw;
  if (!raw) return [];
  const out: LimitWindow[] = [];
  for (const key of KEYS) {
    const w = toWindow(key, raw[key], now);
    if (w) out.push(w);
  }
  return out;
}

/** "51m", "2h 14m", "4d 4h". */
export function formatResetIn(resetsAt: number, now = Date.now()): string {
  const min = Math.max(1, Math.round((resetsAt - now) / 60000));
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h ${min % 60}m`;
  return `${Math.floor(min / 1440)}d ${Math.floor((min % 1440) / 60)}h`;
}

export function onChange(callback: ChangeCallback): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  for (const timer of expiryTimers.values()) clearTimeout(timer);
  expiryTimers.clear();
  limits.clear();
  listeners.length = 0;
}
