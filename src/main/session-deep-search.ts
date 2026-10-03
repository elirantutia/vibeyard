import * as fs from 'fs';
import type { DeepSearchResult } from '../shared/types';
import type { CliProvider, TranscriptDescriptor } from './providers/provider';
import { getAllProviders } from './providers/registry';
import { readSearchIndex, writeSearchIndex, pruneSearchIndex } from './session-search-index';
import { TRANSCRIPT_IO_CONCURRENCY, TRANSCRIPT_TEXT_SEPARATOR, mapWithConcurrency } from './providers/transcript-utils';

const MAX_DERIVED_NAME_LENGTH = 80;

const MAX_CACHE_ENTRIES = 500;
// Counts both original and lowercased text. V8 string storage may use more
// bytes than this character count; this still bounds retained payload size.
const MAX_CACHE_CHARS = 8 * 1024 * 1024;

interface CacheEntry {
  text: string;
  textLower: string;
  cwd: string;
  mtime: number;
  size?: number;
  ctime?: number;
}

const textCache = new Map<string, CacheEntry>();
let cacheChars = 0;

function evictOldest(): void {
  const oldest = textCache.keys().next().value;
  if (oldest === undefined) return;
  const entry = textCache.get(oldest)!;
  cacheChars -= entry.text.length + entry.textLower.length;
  textCache.delete(oldest);
}

export function _resetForTesting(): void {
  textCache.clear();
  cacheChars = 0;
}

let activeReads = 0;
const readWaiters: Array<() => void> = [];
const inFlight = new Map<string, Promise<CacheEntry>>();

async function getCachedIndex(provider: CliProvider, transcriptPath: string): Promise<CacheEntry> {
  const key = provider.meta.id + ':' + transcriptPath;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const work = (async () => {
    if (activeReads >= TRANSCRIPT_IO_CONCURRENCY) await new Promise<void>(resolve => readWaiters.push(resolve));
    else activeReads++;
    try { return await readIndex(provider, transcriptPath); }
    finally {
      const next = readWaiters.shift();
      if (next) next(); else activeReads--;
    }
  })();
  inFlight.set(key, work);
  try { return await work; } finally { if (inFlight.get(key) === work) inFlight.delete(key); }
}

async function readIndex(provider: CliProvider, transcriptPath: string): Promise<CacheEntry> {
  try {
    const stat = await fs.promises.stat(transcriptPath);
    const mtime = stat.mtimeMs;
    const key = provider.meta.id + ":" + transcriptPath;
    const cached = textCache.get(key);
    if (cached && cached.mtime === mtime && cached.size === stat.size && cached.ctime === stat.ctimeMs) {
      // Move-to-end for true LRU semantics on cache hits.
      textCache.delete(key);
      textCache.set(key, cached);
      return cached;
    }

    const version = { mtime, size: stat.size, ctime: stat.ctimeMs };
    const saved = await readSearchIndex(provider.meta.id, transcriptPath, version);
    const { text, cwd } = saved ?? await provider.indexTranscript!(transcriptPath);
    if (!saved) await writeSearchIndex(provider.meta.id, transcriptPath, { text, cwd, ...version });
    const entry: CacheEntry = { text, textLower: text.toLowerCase(), cwd, ...version };
    const old = textCache.get(key);
    if (old) {
      cacheChars -= old.text.length + old.textLower.length;
      textCache.delete(key);
    }
    const size = entry.text.length + entry.textLower.length;
    if (size <= MAX_CACHE_CHARS) {
      while (textCache.size >= MAX_CACHE_ENTRIES || cacheChars + size > MAX_CACHE_CHARS) evictOldest();
      textCache.set(key, entry);
      cacheChars += size;
    }
    return entry;
  } catch {
    return { text: '', textLower: '', cwd: '', mtime: 0 };
  }
}

function scoreFuzzy(textLower: string, query: string): number {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (textLower.includes(q)) return 100;

  const words = q.split(/\s+/).filter(Boolean);
  const matched = words.filter(w => textLower.includes(w));
  if (matched.length === words.length) return 80;
  if (matched.length > 0) return Math.round((matched.length / words.length) * 50);
  return 0;
}

function deriveName(text: string): string | undefined {
  const separator = text.indexOf(TRANSCRIPT_TEXT_SEPARATOR);
  const first = (separator < 0 ? text : text.slice(0, separator)).trim();
  if (!first) return undefined;
  const oneLine = first.replace(/\s+/g, ' ');
  return oneLine.length > MAX_DERIVED_NAME_LENGTH
    ? Buffer.from(oneLine.slice(0, MAX_DERIVED_NAME_LENGTH - 1).trimEnd()).toString('utf8') + '…'
    : Buffer.from(oneLine).toString('utf8');
}

function extractSnippet(text: string, textLower: string, query: string): string {
  const q = query.toLowerCase().trim();
  let idx = textLower.indexOf(q);
  if (idx === -1) {
    const firstWord = q.split(/\s+/)[0];
    idx = firstWord ? textLower.indexOf(firstWord) : -1;
  }
  if (idx === -1) idx = 0;

  const RADIUS = 60;
  const start = Math.max(0, idx - RADIUS);
  const end = Math.min(text.length, idx + Math.min(q.length, 120) + RADIUS);
  let snippet = text.slice(start, end).replace(/\n+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  // Copy the short slice so it cannot retain the complete transcript backing string.
  return Buffer.from(snippet).toString('utf8');
}

async function searchOneProvider(provider: CliProvider, query: string, signal?: AbortSignal): Promise<DeepSearchResult[]> {
  if (!provider.discoverTranscripts || !provider.indexTranscript || signal?.aborted) return [];
  let descriptors: TranscriptDescriptor[];
  try { descriptors = await provider.discoverTranscripts(signal); } catch { return []; }
  if (signal?.aborted) return [];
  // Only compact results escape each worker; evicted transcript text can be collected immediately.
  // Only compact results escape each worker; evicted transcript text can be collected immediately.
  // The same CLI session id can legitimately appear under two profiles (copied
  // history), so the dedup key is profile + cliSessionId; provider is already
  // scoped to this call.
  const best = new Map<string, DeepSearchResult>();
  await mapWithConcurrency(descriptors, TRANSCRIPT_IO_CONCURRENCY, async (desc) => {
    if (signal?.aborted) return;
    const entry = await getCachedIndex(provider, desc.transcriptPath);
    if (signal?.aborted || !entry.textLower) return;
    const score = scoreFuzzy(entry.textLower, query);
    const identity = (desc.profileId ?? '') + '\u0000' + desc.cliSessionId;
    const previous = best.get(identity);
    if (!score || (previous && previous.score >= score)) return;
    best.set(identity, {
      providerId: provider.meta.id, cliSessionId: desc.cliSessionId,
      projectSlug: desc.projectSlug ?? '', projectCwd: desc.projectCwd || entry.cwd,
      snippet: extractSnippet(entry.text, entry.textLower, query), score,
      derivedName: deriveName(entry.text), profileId: desc.profileId,
    });
  });
  if (!signal?.aborted) await pruneSearchIndex(provider.meta.id, descriptors.map(d => d.transcriptPath));
  return [...best.values()];
}

export async function searchSessions(query: string, signal?: AbortSignal): Promise<DeepSearchResult[]> {
  if (!query.trim() || signal?.aborted) return [];
  const results: DeepSearchResult[] = [];
  // Avoid multiplying discovery/index workers across all providers.
  for (const provider of getAllProviders()) {
    if (signal?.aborted) return [];
    for (const result of await searchOneProvider(provider, query, signal)) results.push(result);
  }
  results.sort((a, b) => b.score - a.score);
  return signal?.aborted ? [] : results.slice(0, 20);
}
