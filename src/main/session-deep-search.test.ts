import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { CliProvider, TranscriptDescriptor } from './providers/provider';
import type { ProviderId } from '../shared/types';

vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    realpath: vi.fn(),
  },
}));

const providersForTest: CliProvider[] = [];
vi.mock('./providers/registry', () => ({
  getAllProviders: () => providersForTest,
}));

import * as fs from 'fs';
import { searchSessions, _resetForTesting } from './session-deep-search';

const mockStat = vi.mocked(fs.promises.stat);
const mockRealpath = vi.mocked(fs.promises.realpath);

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
    provider.indexTranscript = vi.fn(async (p: string) => opts.index?.[p] ?? { text: '', cwd: '' });
  }
  return provider as CliProvider;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRealpath.mockImplementation((async (p: string) => p) as unknown as typeof fs.promises.realpath);
  _resetForTesting();
  providersForTest.length = 0;
});

describe('searchSessions()', () => {
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

  it('dedupes by (providerId, cliSessionId), keeping the highest-scoring hit', async () => {
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

describe('searchSessions() with a project scope', () => {
  beforeEach(() => mockStat.mockResolvedValue(makeStat(1)));

  it('keeps only transcripts in the project root or below it', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [
        { cliSessionId: 'root', transcriptPath: '/root' },
        { cliSessionId: 'sub', transcriptPath: '/sub' },
        { cliSessionId: 'other', transcriptPath: '/other' },
        { cliSessionId: 'sibling', transcriptPath: '/sibling' },
      ],
      index: {
        '/root': { text: 'find me', cwd: '/dev/app' },
        '/sub': { text: 'find me', cwd: '/dev/app/src' },
        '/other': { text: 'find me', cwd: '/dev/website' },
        '/sibling': { text: 'find me', cwd: '/dev/app-legacy' },
      },
    }));
    const results = await searchSessions('find me', { projectPath: '/dev/app/' });
    expect(results.map(r => r.cliSessionId).sort()).toEqual(['root', 'sub']);
  });

  it('never indexes descriptors whose known cwd is outside the project', async () => {
    const provider = fakeProvider({
      id: 'codex',
      descriptors: [
        { cliSessionId: 'in', transcriptPath: '/in', projectCwd: '/dev/app' },
        { cliSessionId: 'out', transcriptPath: '/out', projectCwd: '/elsewhere' },
      ],
      index: { '/in': { text: 'find me', cwd: '' }, '/out': { text: 'find me', cwd: '' } },
    });
    providersForTest.push(provider);
    const indexTranscript = vi.mocked(provider.indexTranscript!);

    const results = await searchSessions('find me', { projectPath: '/dev/app' });
    expect(results.map(r => r.cliSessionId)).toEqual(['in']);
    expect(indexTranscript).toHaveBeenCalledTimes(1);
    expect(indexTranscript).toHaveBeenCalledWith('/in');
  });

  it('includes sessions the project already knows about even when their cwd differs', async () => {
    providersForTest.push(fakeProvider({
      id: 'codex',
      descriptors: [{ cliSessionId: 'moved', transcriptPath: '/moved', projectCwd: '/somewhere-else' }],
      index: { '/moved': { text: 'find me', cwd: '' } },
    }));
    const results = await searchSessions('find me', { projectPath: '/dev/app', cliSessionIds: ['moved'] });
    expect(results.map(r => r.cliSessionId)).toEqual(['moved']);
  });

  it('matches a Windows-style cwd against the project path regardless of separators', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'win', transcriptPath: '/win' }],
      index: { '/win': { text: 'find me', cwd: 'C:\\dev\\app\\src' } },
    }));
    const results = await searchSessions('find me', { projectPath: 'C:/dev/app' });
    expect(results.map(r => r.cliSessionId)).toEqual(['win']);
  });

  it('matches transcripts recorded under the realpath of a symlinked project path', async () => {
    mockRealpath.mockImplementation((async () => '/private/tmp/work') as unknown as typeof fs.promises.realpath);
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'real', transcriptPath: '/real' }],
      index: { '/real': { text: 'find me', cwd: '/private/tmp/work' } },
    }));
    const results = await searchSessions('find me', { projectPath: '/tmp/work' });
    expect(results.map(r => r.cliSessionId)).toEqual(['real']);
  });

  it('treats a filesystem-root project as containing every absolute path, not as an empty prefix', async () => {
    providersForTest.push(fakeProvider({
      id: 'claude',
      descriptors: [{ cliSessionId: 'a', transcriptPath: '/a' }, { cliSessionId: 'rel', transcriptPath: '/rel' }],
      index: { '/a': { text: 'find me', cwd: '/dev/app' }, '/rel': { text: 'find me', cwd: 'relative/dir' } },
    }));
    const results = await searchSessions('find me', { projectPath: '/' });
    expect(results.map(r => r.cliSessionId)).toEqual(['a']);
  });

  it('skips Claude transcripts whose folder slug rules out the project, without reading them', async () => {
    const provider = fakeProvider({
      id: 'claude',
      descriptors: [
        { cliSessionId: 'in', transcriptPath: '/in', projectSlug: '-dev-app' },
        { cliSessionId: 'sub', transcriptPath: '/sub', projectSlug: '-dev-app-src' },
        { cliSessionId: 'out', transcriptPath: '/out', projectSlug: '-dev-website' },
      ],
      index: {
        '/in': { text: 'find me', cwd: '/dev/app' },
        '/sub': { text: 'find me', cwd: '/dev/app/src' },
        '/out': { text: 'find me', cwd: '/dev/website' },
      },
    });
    providersForTest.push(provider);

    const results = await searchSessions('find me', { projectPath: '/dev/app' });
    expect(results.map(r => r.cliSessionId).sort()).toEqual(['in', 'sub']);
    expect(vi.mocked(provider.indexTranscript!).mock.calls.map(([p]) => p).sort()).toEqual(['/in', '/sub']);
  });
});
