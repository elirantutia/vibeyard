import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';

import { computeCost, type UsageEntry } from './pricing';
import { costEvents, type CostDataPayload } from './cost-events';
import { dirExists, readDirSafe, readFileSafe } from './fs-utils';
import type { BlockInfo } from '../shared/types';

export type { BlockInfo };

interface ParsedEntry {
  timestamp: number; // UTC ms (clamped to now if future)
  cost: number;
  messageId: string | null; // Anthropic message.id, used to dedupe replayed entries
}

interface CachedFile {
  mtimeMs: number;
  entries: ParsedEntry[];
}

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;
const DEBOUNCE_MS = 250;
const RETRY_MS = 1500;
const TICKER_MS = 30_000;

const emitter = new EventEmitter();
const fileCache = new Map<string, CachedFile>();

let lastEmitted: BlockInfo | null = null;
let initialized = false;
let readyResolve: (() => void) | null = null;
let readyPromise: Promise<void> = new Promise((r) => {
  readyResolve = r;
});
let isReady = false;

let debounceTimer: NodeJS.Timeout | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let tickerInterval: NodeJS.Timeout | null = null;
// Set when a cost event triggers a recompute. If the recompute produces no
// change, the JSONL line may not have flushed yet — schedule a single retry.
let costEventPending = false;
let costEventsListener: ((payload: CostDataPayload) => void) | null = null;

function projectsDir(): string {
  return path.join(os.homedir(), '.claude', 'projects');
}

function listJsonlFiles(): string[] {
  const root = projectsDir();
  const out: string[] = [];
  for (const projectName of readDirSafe(root)) {
    const projectPath = path.join(root, projectName);
    if (!dirExists(projectPath)) continue;
    for (const f of readDirSafe(projectPath)) {
      if (f.endsWith('.jsonl')) {
        out.push(path.join(projectPath, f));
      }
    }
  }
  return out;
}

function parseFile(filePath: string, now: number): ParsedEntry[] {
  const content = readFileSafe(filePath);
  if (content === null) return [];
  const entries: ParsedEntry[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // malformed line; skip silently
    }
    const ts = typeof obj.timestamp === 'string' ? Date.parse(obj.timestamp) : NaN;
    if (!Number.isFinite(ts)) continue;
    const message = obj.message as
      | { model?: string; usage?: UsageEntry; id?: string }
      | undefined;
    if (!message?.model || !message.usage) continue;
    const cost = computeCost(message.model, message.usage);
    if (cost === null) continue; // unknown model — skip
    // Clamp future timestamps to now (clock skew)
    const clamped = ts > now ? now : ts;
    entries.push({
      timestamp: clamped,
      cost,
      messageId: typeof message.id === 'string' ? message.id : null,
    });
  }
  return entries;
}

function refreshCache(now: number): void {
  const files = listJsonlFiles();
  const seen = new Set<string>();
  const cutoff = now - FIVE_HOURS_MS - FIVE_MIN_MS;

  for (const filePath of files) {
    seen.add(filePath);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      fileCache.delete(filePath);
      continue;
    }
    if (stat.mtimeMs < cutoff) {
      // Cannot contribute to current 5h window — drop and skip read
      fileCache.delete(filePath);
      continue;
    }
    const cached = fileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      continue; // unchanged; reuse
    }
    const entries = parseFile(filePath, now);
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, entries });
  }

  // Drop cache entries for files that no longer exist on disk
  for (const cachedPath of fileCache.keys()) {
    if (!seen.has(cachedPath)) {
      fileCache.delete(cachedPath);
    }
  }
}

function computeBlock(now: number): BlockInfo | null {
  const windowStart = now - FIVE_HOURS_MS;
  let usdSpent = 0;
  let oldestInWindow = Infinity;
  let entryCount = 0;
  // Dedupe by Anthropic message.id — Claude appends prior turns when sessions
  // resume, so the same usage entry can appear multiple times across (or
  // within) JSONL files. Entries without an id (older format) fall through.
  const seenIds = new Set<string>();

  for (const cached of fileCache.values()) {
    for (const entry of cached.entries) {
      if (entry.timestamp < windowStart) continue;
      if (entry.messageId !== null) {
        if (seenIds.has(entry.messageId)) continue;
        seenIds.add(entry.messageId);
      }
      usdSpent += entry.cost;
      entryCount++;
      if (entry.timestamp < oldestInWindow) {
        oldestInWindow = entry.timestamp;
      }
    }
  }

  if (entryCount === 0) return null;
  return {
    usdSpent,
    resetsAt: oldestInWindow + FIVE_HOURS_MS,
    entryCount,
  };
}

function roundedEqual(a: BlockInfo | null, b: BlockInfo | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    Math.round(a.usdSpent * 100) === Math.round(b.usdSpent * 100) &&
    a.resetsAt === b.resetsAt &&
    a.entryCount === b.entryCount
  );
}

function recompute(): void {
  try {
    const now = Date.now();
    refreshCache(now);
    const next = computeBlock(now);
    const changed = !roundedEqual(next, lastEmitted);
    if (changed) {
      lastEmitted = next;
      emitter.emit('block-changed', next);
      costEventPending = false;
    } else if (costEventPending) {
      costEventPending = false;
      scheduleRetry();
    }
  } catch {
    // Preserve prior BlockInfo on scan error
  }
}

function scheduleRecompute(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    recompute();
  }, DEBOUNCE_MS);
}

function scheduleRetry(): void {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    recompute();
  }, RETRY_MS);
}

export function init(): void {
  if (initialized) return;
  initialized = true;

  costEventsListener = () => {
    costEventPending = true;
    scheduleRecompute();
  };
  costEvents.on('costData', costEventsListener);

  tickerInterval = setInterval(() => {
    recompute();
  }, TICKER_MS);

  // Startup scan (synchronous, but resolves the ready promise)
  try {
    recompute();
  } finally {
    isReady = true;
    if (readyResolve) {
      const r = readyResolve;
      readyResolve = null;
      r();
    }
  }
}

export function dispose(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (tickerInterval) {
    clearInterval(tickerInterval);
    tickerInterval = null;
  }
  if (costEventsListener) {
    costEvents.off('costData', costEventsListener);
    costEventsListener = null;
  }
  initialized = false;
}

export async function getCurrentBlock(): Promise<BlockInfo | null> {
  if (!isReady) await readyPromise;
  return lastEmitted;
}

export async function refresh(): Promise<void> {
  if (!isReady) await readyPromise;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  recompute();
}

export function onBlockChange(cb: (info: BlockInfo | null) => void): () => void {
  emitter.on('block-changed', cb);
  return () => emitter.off('block-changed', cb);
}

export function _resetForTesting(): void {
  dispose();
  fileCache.clear();
  lastEmitted = null;
  costEventPending = false;
  emitter.removeAllListeners();
  isReady = false;
  readyPromise = new Promise((r) => {
    readyResolve = r;
  });
}
