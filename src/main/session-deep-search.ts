import * as fs from 'fs';
import type { DeepSearchResult } from '../shared/types';
import type { CliProvider, TranscriptDescriptor } from './providers/provider';
import { getAllProviders } from './providers/registry';

const MAX_CACHE_ENTRIES = 500;

interface CacheEntry {
  text: string;
  textLower: string;
  cwd: string;
  mtime: number;
}

const textCache = new Map<string, CacheEntry>();

export function _resetForTesting(): void {
  textCache.clear();
}

async function getCachedIndex(provider: CliProvider, transcriptPath: string): Promise<CacheEntry> {
  try {
    const stat = await fs.promises.stat(transcriptPath);
    const mtime = stat.mtimeMs;
    const cached = textCache.get(transcriptPath);
    if (cached && cached.mtime === mtime) {
      // Move-to-end for true LRU semantics on cache hits.
      textCache.delete(transcriptPath);
      textCache.set(transcriptPath, cached);
      return cached;
    }

    if (textCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = textCache.keys().next().value;
      if (oldest) textCache.delete(oldest);
    }

    const { text, cwd } = await provider.indexTranscript!(transcriptPath);
    const entry: CacheEntry = { text, textLower: text.toLowerCase(), cwd, mtime };
    textCache.set(transcriptPath, entry);
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
  const end = Math.min(text.length, idx + q.length + RADIUS);
  let snippet = text.slice(start, end).replace(/\n+/g, ' ').trim();
  if (start > 0) snippet = '…' + snippet;
  if (end < text.length) snippet = snippet + '…';
  return snippet;
}

async function searchOneProvider(provider: CliProvider, query: string): Promise<DeepSearchResult[]> {
  if (!provider.discoverTranscripts || !provider.indexTranscript) return [];
  let descriptors: TranscriptDescriptor[];
  try {
    descriptors = await provider.discoverTranscripts();
  } catch {
    return [];
  }
  const indexed = await Promise.all(descriptors.map(async (desc) => {
    const entry = await getCachedIndex(provider, desc.transcriptPath);
    return { desc, entry };
  }));
  const out: DeepSearchResult[] = [];
  for (const { desc, entry } of indexed) {
    if (!entry.textLower) continue;
    const score = scoreFuzzy(entry.textLower, query);
    if (score === 0) continue;
    out.push({
      providerId: provider.meta.id,
      cliSessionId: desc.cliSessionId,
      projectSlug: desc.projectSlug ?? '',
      projectCwd: desc.projectCwd || entry.cwd,
      snippet: extractSnippet(entry.text, entry.textLower, query),
      score,
    });
  }
  return out;
}

export async function searchSessions(query: string): Promise<DeepSearchResult[]> {
  const all = await Promise.all(getAllProviders().map((p) => searchOneProvider(p, query)));
  const results = all.flat();
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}
