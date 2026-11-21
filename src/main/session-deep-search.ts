import * as fs from 'fs';
import type { DeepSearchResult, DeepSearchScope } from '../shared/types';
import { isPathUnder } from '../shared/platform';
import type { CliProvider, TranscriptDescriptor } from './providers/provider';
import { getAllProviders } from './providers/registry';
import { TRANSCRIPT_TEXT_SEPARATOR, claudeProjectSlug } from './providers/transcript-utils';

const MAX_DERIVED_NAME_LENGTH = 80;

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

/** Unify separators and drop trailing ones (the filesystem root becomes '', which `isPathUnder` treats as containing every absolute path). */
function normalizeDir(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * The scope's project roots: the path as the user added it plus its realpath. CLIs record
 * the resolved `process.cwd()`, so a project added through a symlink would otherwise match nothing.
 */
async function projectRoots(projectPath: string): Promise<string[]> {
  const roots = [normalizeDir(projectPath)];
  try {
    const real = normalizeDir(await fs.promises.realpath(projectPath));
    if (real !== roots[0]) roots.push(real);
  } catch { /* missing or unreadable — the given path is all we have */ }
  return roots;
}

/** True when `cwd` is one of the project roots or anywhere beneath one, ignoring separator style. */
function inProject(cwd: string, roots: string[]): boolean {
  if (!cwd) return false;
  const dir = normalizeDir(cwd);
  return roots.some((root) => isPathUnder(dir, root));
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
  const first = text.split(TRANSCRIPT_TEXT_SEPARATOR)[0]?.trim();
  if (!first) return undefined;
  const oneLine = first.replace(/\s+/g, ' ');
  return oneLine.length > MAX_DERIVED_NAME_LENGTH
    ? oneLine.slice(0, MAX_DERIVED_NAME_LENGTH - 1).trimEnd() + '…'
    : oneLine;
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

interface ResolvedScope {
  roots: string[];
  /** `claudeProjectSlug` of each root; '' for the filesystem root, which rules nothing out. */
  claudeSlugs: string[];
  cliSessionIds: Set<string>;
}

async function searchOneProvider(provider: CliProvider, query: string, scope?: ResolvedScope): Promise<DeepSearchResult[]> {
  if (!provider.discoverTranscripts || !provider.indexTranscript) return [];
  let descriptors: TranscriptDescriptor[];
  try {
    descriptors = await provider.discoverTranscripts();
  } catch {
    return [];
  }
  const keep = (id: string, cwd: string): boolean =>
    !scope || scope.cliSessionIds.has(id) || inProject(cwd, scope.roots);
  // Narrow before reading any file: a known cwd decides now. Claude descriptors carry
  // only the folder slug, which is lossy, so it can rule a transcript out but not in.
  const candidates = descriptors.filter((d) => {
    if (d.projectCwd) return keep(d.cliSessionId, d.projectCwd);
    if (!scope || provider.meta.id !== 'claude' || !d.projectSlug) return true;
    return scope.cliSessionIds.has(d.cliSessionId) || scope.claudeSlugs.some((slug) =>
      slug === '' || d.projectSlug === slug || d.projectSlug!.startsWith(slug + '-'));
  });
  const indexed = (await Promise.all(candidates.map(async (desc) => {
    const entry = await getCachedIndex(provider, desc.transcriptPath);
    return { desc, entry };
  }))).filter(({ desc, entry }) => !!desc.projectCwd || keep(desc.cliSessionId, entry.cwd));
  // Same cliSessionId can appear under multiple project slugs (e.g. Claude
  // resumes that move between cwds); keep the highest-scoring transcript.
  const best = new Map<string, { desc: TranscriptDescriptor; entry: CacheEntry; score: number }>();
  for (const { desc, entry } of indexed) {
    if (!entry.textLower) continue;
    const score = scoreFuzzy(entry.textLower, query);
    if (score === 0) continue;
    const prev = best.get(desc.cliSessionId);
    if (!prev || score > prev.score) best.set(desc.cliSessionId, { desc, entry, score });
  }
  const out: DeepSearchResult[] = [];
  for (const { desc, entry, score } of best.values()) {
    out.push({
      providerId: provider.meta.id,
      cliSessionId: desc.cliSessionId,
      projectSlug: desc.projectSlug ?? '',
      projectCwd: desc.projectCwd || entry.cwd,
      snippet: extractSnippet(entry.text, entry.textLower, query),
      score,
      derivedName: deriveName(entry.text),
      profileId: desc.profileId,
    });
  }
  return out;
}

/** Searches every provider's transcripts, or only one project's when `scope` is given. */
export async function searchSessions(query: string, scope?: DeepSearchScope): Promise<DeepSearchResult[]> {
  let resolved: ResolvedScope | undefined;
  if (scope) {
    const roots = await projectRoots(scope.projectPath);
    resolved = { roots, claudeSlugs: roots.map(claudeProjectSlug), cliSessionIds: new Set(scope.cliSessionIds) };
  }
  const all = await Promise.all(getAllProviders().map((p) => searchOneProvider(p, query, resolved)));
  const results = all.flat();
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}
