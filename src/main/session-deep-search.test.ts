vi.mock('./session-search-index', () => ({ readSearchIndex: vi.fn(async () => null), writeSearchIndex: vi.fn(async () => {}), pruneSearchIndex: vi.fn(async () => {}) }));
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CliProvider, TranscriptDescriptor } from './providers/provider';
import type { ProviderId } from '../shared/types';

vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
  },
}));

const providersForTest: CliProvider[] = [];
vi.mock('./providers/registry', () => ({
  getAllProviders: () => providersForTest,
}));

import * as fs from 'fs';
import { readSearchIndex, writeSearchIndex } from './session-search-index';
import { searchSessions, _resetForTesting } from './session-deep-search';

const mockStat = vi.mocked(fs.promises.stat);

function makeStat(mtime: number): Awaited<ReturnType<typeof fs.promises.stat>> {
  return { mtimeMs: mtime } as Awaited<ReturnType<typeof fs.promises.stat>>;
}

interface FakeProviderOpts {
  id: ProviderId;
  descriptors?: TranscriptDescriptor[];
  index?: Record<string, { text: string; cwd: string }>;
  discoverThrows?: boolean;
  omitDiscover?: boolean;
  omitIndex?: boolean;
}

function fakeProvider(opts: FakeProviderOpts): CliProvider {
  const provider: Partial<CliProvider> = {
    meta: { id: opts.id, displayName: opts.id, binaryName: opts.id, capabilities: {} as any, defaultContextWindowSize: 0 },
  };
  if (!opts.omitDiscover) {
    provider.discoverTranscripts = async () => {
      if (opts.discoverThrows) throw new Error('boom');
      return opts.descriptors ?? [];
    };
  }
  if (!opts.omitIndex) {
    provider.indexTranscript = async (p: string) => opts.index?.[p] ?? { text: '', cwd: '' };
  }
  return provider as CliProvider;
}

beforeEach(() => {
  vi.mocked(readSearchIndex).mockReset().mockResolvedValue(null);
  vi.mocked(writeSearchIndex).mockReset().mockResolvedValue(undefined);
  vi.clearAllMocks();
  _resetForTesting();
  providersForTest.length = 0;
});

describe('searchSessions()', () => {
  it('limits transcript indexing to four concurrent files per provider', async () => {
    let active = 0;
    let peak = 0;
    const provider = fakeProvider({
      id: 'claude',
      descriptors: Array.from({ length: 12 }, (_, i) => ({ cliSessionId: `s${i}`, transcriptPath: `/p${i}` })),
    });
    provider.indexTranscript = async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return { text: 'match', cwd: '' };
    };
    providersForTest.push(provider);
    mockStat.mockResolvedValue(makeStat(1));
    await searchSessions('match');
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });

  it('returns empty when no providers are registered', async () => {
    expect(await searchSessions('hello')).toEqual([]);
  });

  it('returns empty when no providers implement discover/index', async () => {
    providersForTest.push(fakeProvider({ id: 'claude', omitDiscover: true }));
    providersForTest.push(fakeProvider({ id: 'codex', omitIndex: true }));
    expect(await searchSessions('hello')).toEqual([]);
  });

  it('skips providers whose discoverTranscripts throws', async () => {
    providersForTest.push(fakeProvider({ id: 'claude', discoverThrows: true }));
    providersForTest.push(fakeProvider({
      id: 'codex',
      descriptors: [{ cliSessionId: 'cx', transcriptPath: '/tx', projectCwd: '/p' }],
      index: { '/tx': { text: 'find me', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('find me');
    expect(results).toHaveLength(1);
    expect(results[0].providerId).toBe('codex');
  });

  it('stamps providerId on each result and sorts merged hits by score desc', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'cl-1', transcriptPath: '/cl-1', projectSlug: 'cl-slug' }],
      index: { '/cl-1': { text: 'only deploy here nothing else', cwd: '/a' } }, // partial → 25
    }));
    providersForTest.push(fakeProvider({
      id: 'codex',
      descriptors: [{ cliSessionId: 'cx-1', transcriptPath: '/cx-1', projectCwd: '/b' }],
      index: { '/cx-1': { text: 'deploy kubernetes cluster', cwd: '' } }, // exact → 100
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await searchSessions('deploy kubernetes');
    expect(results.map(r => r.providerId)).toEqual(['codex', 'claude']);
    expect(results[0].score).toBe(100);
    expect(results[0].cliSessionId).toBe('cx-1');
    expect(results[0].projectCwd).toBe('/b');
    expect(results[1].score).toBe(25);
    expect(results[1].projectCwd).toBe('/a');
    expect(results[1].projectSlug).toBe('cl-slug');
  });

  it('prefers descriptor.projectCwd over indexed cwd when both present', async () => {
    providersForTest.push(fakeProvider({
      id: 'gemini',
      descriptors: [{ cliSessionId: 'g1', transcriptPath: '/g', projectCwd: '/from-descriptor' }],
      index: { '/g': { text: 'searchable hit', cwd: '/from-index' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('searchable hit');
    expect(results[0].projectCwd).toBe('/from-descriptor');
  });

  it('falls back to indexed cwd when descriptor has none', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'c1', transcriptPath: '/c' }],
      index: { '/c': { text: 'searchable hit', cwd: '/from-index' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('searchable hit');
    expect(results[0].projectCwd).toBe('/from-index');
  });

  it('caps results at 20 across all providers', async () => {
    const desc = (i: number): TranscriptDescriptor => ({ cliSessionId: `s${i}`, transcriptPath: `/p${i}` });
    const idx: Record<string, { text: string; cwd: string }> = {};
    const descsA: TranscriptDescriptor[] = [];
    const descsB: TranscriptDescriptor[] = [];
    for (let i = 0; i < 15; i++) {
      descsA.push(desc(i));
      idx[`/p${i}`] = { text: 'find me please', cwd: '' };
    }
    for (let i = 15; i < 30; i++) {
      descsB.push(desc(i));
      idx[`/p${i}`] = { text: 'find me please', cwd: '' };
    }
    providersForTest.push(fakeProvider({ id: 'claude', descriptors: descsA, index: idx }));
    providersForTest.push(fakeProvider({ id: 'codex', descriptors: descsB, index: idx }));
    mockStat.mockResolvedValue(makeStat(1));
    expect(await searchSessions('find me')).toHaveLength(20);
  });

  it('dedupes by (providerId, profileId, cliSessionId), keeping the highest-scoring hit', async () => {
    // Same Claude session indexed under two project slugs — both transcripts contain
    // the query but with different match strength. Only the higher-scoring one survives.
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [
        { cliSessionId: 'dup', transcriptPath: '/slug-a/dup.jsonl', projectSlug: 'slug-a', projectCwd: '/a' },
        { cliSessionId: 'dup', transcriptPath: '/slug-b/dup.jsonl', projectSlug: 'slug-b', projectCwd: '/b' },
        { cliSessionId: 'unique', transcriptPath: '/slug-a/unique.jsonl', projectSlug: 'slug-a', projectCwd: '/a' },
      ],
      index: {
        '/slug-a/dup.jsonl': { text: 'deploy kubernetes cluster', cwd: '/a' }, // exact → 100
        '/slug-b/dup.jsonl': { text: 'only deploy here nothing else', cwd: '/b' }, // partial → 25
        '/slug-a/unique.jsonl': { text: 'deploy kubernetes cluster', cwd: '/a' }, // exact → 100
      },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await searchSessions('deploy kubernetes');
    expect(results).toHaveLength(2);
    const dup = results.find(r => r.cliSessionId === 'dup');
    expect(dup).toBeDefined();
    expect(dup!.score).toBe(100);
    expect(dup!.projectSlug).toBe('slug-a');
  });

  it('keeps separate entries when the same cliSessionId appears under two profiles', async () => {
    // Copied history: the same session UUID legitimately exists in two
    // profile config dirs. Both must stay separately discoverable.
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [
        { cliSessionId: 'dup', transcriptPath: '/one/dup.jsonl', profileId: 'one', projectCwd: '/one' },
        { cliSessionId: 'dup', transcriptPath: '/two/dup.jsonl', profileId: 'two', projectCwd: '/two' },
      ],
      index: {
        '/one/dup.jsonl': { text: 'find me', cwd: '/one' },
        '/two/dup.jsonl': { text: 'find me', cwd: '/two' },
      },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await searchSessions('find me');
    expect(results).toHaveLength(2);
    expect(new Set(results.map(r => r.profileId))).toEqual(new Set(['one', 'two']));
    expect(new Set(results.map(r => r.projectCwd))).toEqual(new Set(['/one', '/two']));
  });

  it('keeps separate entries when different providers report the same cliSessionId', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'shared-uuid', transcriptPath: '/cl', projectCwd: '/cl' }],
      index: { '/cl': { text: 'find me', cwd: '/cl' } },
    }));
    providersForTest.push(fakeProvider({
      id: 'codex',
      descriptors: [{ cliSessionId: 'shared-uuid', transcriptPath: '/cx', projectCwd: '/cx' }],
      index: { '/cx': { text: 'find me', cwd: '/cx' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));

    const results = await searchSessions('find me');
    expect(results).toHaveLength(2);
    expect(new Set(results.map(r => r.providerId))).toEqual(new Set(['claude', 'codex']));
  });

  it('derives a name from the first transcript segment', async () => {
    const text = 'fix duplicate search rows in the palette\n---\nfollow-up message about something else with the find me query';
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'd1', transcriptPath: '/d1' }],
      index: { '/d1': { text, cwd: '/repo' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('find me');
    expect(results[0].derivedName).toBe('fix duplicate search rows in the palette');
  });

  it('truncates long derived names with an ellipsis', async () => {
    const longLine = 'a'.repeat(200);
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'd2', transcriptPath: '/d2' }],
      index: { '/d2': { text: longLine + '\nfind me\n---\nmore', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('find me');
    expect(results[0].derivedName).toMatch(/…$/);
    expect(results[0].derivedName!.length).toBeLessThanOrEqual(80);
  });

  it('caches indexed text by mtime and avoids re-indexing on second search', async () => {
    const indexSpy = vi.fn(async () => ({ text: 'cached body content', cwd: '/x' }));
    const provider: CliProvider = {
      meta: { id: 'claude', displayName: 'c', binaryName: 'c', capabilities: {} as any, defaultContextWindowSize: 0 },
      discoverTranscripts: async () => [{ cliSessionId: 'a', transcriptPath: '/a' }],
      indexTranscript: indexSpy,
    } as CliProvider;
    providersForTest.push(provider);
    mockStat.mockResolvedValue(makeStat(42));

    await searchSessions('cached body');
    await searchSessions('cached body');
    expect(indexSpy).toHaveBeenCalledTimes(1);
  });

  it('re-indexes when mtime changes', async () => {
    const indexSpy = vi.fn(async () => ({ text: 'updated body content', cwd: '/x' }));
    const provider: CliProvider = {
      meta: { id: 'claude', displayName: 'c', binaryName: 'c', capabilities: {} as any, defaultContextWindowSize: 0 },
      discoverTranscripts: async () => [{ cliSessionId: 'a', transcriptPath: '/a' }],
      indexTranscript: indexSpy,
    } as CliProvider;
    providersForTest.push(provider);
    mockStat
      .mockResolvedValueOnce(makeStat(100))
      .mockResolvedValueOnce(makeStat(200));
    await searchSessions('updated body');
    await searchSessions('updated body');
    expect(indexSpy).toHaveBeenCalledTimes(2);
  });

  it('drops zero-score sessions', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'a', transcriptPath: '/a' }],
      index: { '/a': { text: 'completely unrelated content', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    expect(await searchSessions('zzz qqq')).toEqual([]);
  });

  it('snippet includes context around the match', async () => {
    const content = 'A'.repeat(70) + 'needle' + 'B'.repeat(70);
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'a', transcriptPath: '/a' }],
      index: { '/a': { text: content, cwd: '/repo' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    const results = await searchSessions('needle');
    expect(results[0].snippet).toContain('needle');
    expect(results[0].snippet).toMatch(/…/);
  });

  it('gibberish query returns no results', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'a', transcriptPath: '/a' }],
      index: { '/a': { text: 'please add some documentation and cover all cases very well', cwd: '' } },
    }));
    mockStat.mockResolvedValue(makeStat(1));
    expect(await searchSessions('asdcv')).toEqual([]);
  });
});


it('shares reads and keeps aggregate indexing concurrency at four across requests', async () => {
  let active = 0, peak = 0;
  const provider = fakeProvider({ id: 'claude', descriptors: Array.from({length: 30}, (_, i) => ({cliSessionId: 's'+i, transcriptPath: '/p'+i})) });
  const index = vi.fn(async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1));
    active--;
    return {text: 'shared match', cwd: ''};
  });
  provider.indexTranscript = index;
  providersForTest.push(provider); mockStat.mockResolvedValue(makeStat(1));
  await Promise.all([searchSessions('match'), searchSessions('shared')]);
  expect(peak).toBeLessThanOrEqual(4);
  expect(index).toHaveBeenCalledTimes(30);
});

it('stops scheduling transcript reads after cancellation', async () => {
  const controller = new AbortController();
  const provider = fakeProvider({ id: 'claude', descriptors: Array.from({length: 1000}, (_, i) => ({cliSessionId: 's'+i, transcriptPath: '/p'+i})) });
  provider.indexTranscript = vi.fn(async () => { controller.abort(); return {text: 'match', cwd: ''}; });
  providersForTest.push(provider); mockStat.mockResolvedValue(makeStat(1));
  expect(await searchSessions('match', controller.signal)).toEqual([]);
  expect(provider.indexTranscript).toHaveBeenCalledTimes(4);
});

it('does not reparse unchanged transcripts when the corpus exceeds the memory cache', async () => {
  const disk = new Map<string, any>();
  vi.mocked(readSearchIndex).mockImplementation(async (_provider, source, version) => {
    const record = disk.get(source);
    return record?.mtime === version.mtime ? record : null;
  });
  vi.mocked(writeSearchIndex).mockImplementation(async (_provider, source, data) => { disk.set(source, data); });
  const provider = fakeProvider({ id: 'claude', descriptors: Array.from({length: 1000}, (_, i) => ({cliSessionId: 's'+i, transcriptPath: '/p'+i})) });
  provider.indexTranscript = vi.fn(async () => ({text: 'match ' + 'x'.repeat(51194), cwd: ''}));
  providersForTest.push(provider); mockStat.mockResolvedValue(makeStat(1));
  await searchSessions('match');
  await searchSessions('match');
  expect(provider.indexTranscript).toHaveBeenCalledTimes(1000);
  _resetForTesting();
  await searchSessions('match');
  expect(provider.indexTranscript).toHaveBeenCalledTimes(1000);
});
