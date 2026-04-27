import { appState } from './state.js';

const DISCUSSIONS_BASE = 'https://github.com/elirantutia/vibeyard/discussions';
const SORT_QUERY = '?discussions_q=sort:date_created';
export const DISCUSSIONS_URL = DISCUSSIONS_BASE + SORT_QUERY;
const FEED_URL = DISCUSSIONS_BASE + '.atom' + SORT_QUERY;
const POLL_INTERVAL = 3_600_000;

type ChangeCallback = () => void;

let newCount = 0;
let latestTimestamp: string | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners: ChangeCallback[] = [];

function notify(): void {
  for (const cb of listeners) cb();
}

async function poll(): Promise<void> {
  try {
    const res = await fetch(FEED_URL);
    if (!res.ok) return;
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const entries = doc.querySelectorAll('entry');
    if (entries.length === 0) return;

    let newest: string | null = null;
    const timestamps: string[] = [];
    for (const entry of entries) {
      const published = entry.querySelector('published')?.textContent?.trim();
      if (published) {
        timestamps.push(published);
        if (!newest || published > newest) newest = published;
      }
    }
    latestTimestamp = newest;

    const lastSeen = appState.discussionsLastSeen;
    const prevCount = newCount;
    newCount = lastSeen ? timestamps.filter(t => t > lastSeen).length : timestamps.length;
    if (newCount !== prevCount) notify();
  } catch {
    // Silently skip — network errors, rate limits, etc.
  }
}

function startInterval(): void {
  if (pollTimer) return;
  if (document.hidden) return;
  poll();
  pollTimer = setInterval(poll, POLL_INTERVAL);
}

function stopInterval(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function init(): void {
  appState.on('state-loaded', () => startInterval());

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopInterval();
    } else {
      startInterval();
    }
  });
}

export function getNewCount(): number {
  return newCount;
}

export function markSeen(): void {
  if (latestTimestamp) {
    appState.setDiscussionsLastSeen(latestTimestamp);
  }
  newCount = 0;
  notify();
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
  newCount = 0;
  latestTimestamp = null;
  stopInterval();
  listeners.length = 0;
}
