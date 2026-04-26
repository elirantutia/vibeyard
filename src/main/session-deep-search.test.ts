import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
  },
}));

vi.mock('os', () => ({
  homedir: () => '/mock/home',
}));

import * as fs from 'fs';
import { searchSessions, _resetForTesting } from './session-deep-search';

const mockReadFile = vi.mocked(fs.promises.readFile);
const mockStat = vi.mocked(fs.promises.stat);
const mockReaddir = vi.mocked(fs.promises.readdir);

const FAKE_UUID = '550e8400-e29b-41d4-a716-446655440000';

function makeStat(opts: { isDirectory?: boolean; mtime?: number } = {}): Awaited<ReturnType<typeof fs.promises.stat>> {
  return {
    isDirectory: () => opts.isDirectory ?? false,
    mtimeMs: opts.mtime ?? 1000,
  } as Awaited<ReturnType<typeof fs.promises.stat>>;
}

function makeJsonl(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTesting();
});

describe('searchSessions()', () => {
  it('returns empty array when projects dir does not exist', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await searchSessions('hello')).toEqual([]);
  });

  it('returns empty array when projects dir is empty', async () => {
    mockReaddir.mockResolvedValueOnce([] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    expect(await searchSessions('hello')).toEqual([]);
  });

  it('finds exact phrase match with score 100', async () => {
    const slug = 'Users-itay-repo';
    const jsonl = makeJsonl([
      { cwd: '/Users/itay/repo' },
      { type: 'user', message: { content: 'hello world this is a test' } },
    ]);

    mockReaddir
      .mockResolvedValueOnce([slug] as unknown as Awaited<ReturnType<typeof mockReaddir>>)   // slugDirs
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);  // files in slug
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))   // slugPath stat
      .mockResolvedValueOnce(makeStat({ mtime: 1234 }));        // file stat for cache
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('hello world');
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(100);
    expect(results[0].cliSessionId).toBe(FAKE_UUID);
    expect(results[0].projectCwd).toBe('/Users/itay/repo');
    expect(results[0].projectSlug).toBe(slug);
    expect(results[0].snippet).toBeTruthy();
  });

  it('scores all-words match at 80', async () => {
    const jsonl = makeJsonl([
      { cwd: '/repo' },
      { type: 'user', message: { content: 'fix the memory leak in the allocator' } },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['repo'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('memory allocator');
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(80);
  });

  it('scores partial word match proportionally', async () => {
    const jsonl = makeJsonl([
      { cwd: '/repo' },
      { type: 'user', message: { content: 'only memory here nothing else' } },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['repo'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('memory allocator');
    expect(results).toHaveLength(1);
    // 1/2 words matched → score = round(50 * 1/2) = 25
    expect(results[0].score).toBe(25);
  });

  it('skips non-UUID filenames', async () => {
    mockReaddir
      .mockResolvedValueOnce(['proj'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce(['history.jsonl', 'settings.json', 'notes.jsonl'] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat.mockResolvedValueOnce(makeStat({ isDirectory: true }));

    const results = await searchSessions('anything');
    expect(results).toHaveLength(0);
    // readFile should never be called since all filenames are invalid UUIDs
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('skips non-directory entries in projects dir', async () => {
    mockReaddir
      .mockResolvedValueOnce(['file.json', 'validslug'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    // First slug: not a directory
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: false }))
      // Second slug: is a directory
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      // File stat for the JSONL
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));

    const jsonl = makeJsonl([
      { type: 'user', message: { content: 'find this text' } },
    ]);
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('find this text');
    // Only the second slug (directory) should be searched
    expect(results).toHaveLength(1);
    expect(results[0].projectSlug).toBe('validslug');
  });

  it('extracts cwd from first JSONL entry that has cwd field', async () => {
    const jsonl = makeJsonl([
      { cwd: '/projects/myapp' },
      { type: 'user', message: { content: 'deploy the app' } },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['slug'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('deploy');
    expect(results[0].projectCwd).toBe('/projects/myapp');
  });

  it('handles content as array of text blocks', async () => {
    const jsonl = makeJsonl([
      { cwd: '/repo' },
      {
        type: 'user',
        message: {
          content: [
            { type: 'text', text: 'refactor the authentication module' },
            { type: 'tool_use', id: 'tool1' },
          ],
        },
      },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['repo'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('authentication');
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(100);
  });

  it('ignores non-user message types', async () => {
    const jsonl = makeJsonl([
      { cwd: '/repo' },
      { type: 'assistant', message: { content: 'xylophone quantum' } },
      { type: 'system', message: { content: 'xylophone quantum' } },
      { type: 'user', message: { content: 'completely different text here' } },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['repo'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    // 'xylophone quantum' only appears in assistant/system messages, not user
    const results = await searchSessions('xylophone quantum');
    expect(results).toHaveLength(0);
  });

  it('returns zero score and excludes session when query has no match', async () => {
    const jsonl = makeJsonl([
      { cwd: '/repo' },
      { type: 'user', message: { content: 'hello world' } },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['repo'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('zzzzzzzzz');
    expect(results).toHaveLength(0);
  });

  it('returns results sorted by score descending', async () => {
    const uuidHigh = '550e8400-e29b-41d4-a716-446655440001'; // slug-a, exact match
    const uuidLow  = '550e8400-e29b-41d4-a716-446655440002'; // slug-b, partial match
    const jsonlHigh = makeJsonl([
      { cwd: '/a' },
      { type: 'user', message: { content: 'deploy kubernetes cluster' } },
    ]);
    const jsonlLow = makeJsonl([
      { cwd: '/b' },
      { type: 'user', message: { content: 'only deploy here nothing else' } },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['slug-a', 'slug-b'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${uuidHigh}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>) // slug-a: exact
      .mockResolvedValueOnce([`${uuidLow}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);  // slug-b: partial
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true })) // slug-a
      .mockResolvedValueOnce(makeStat({ mtime: 1 }))          // uuidHigh file
      .mockResolvedValueOnce(makeStat({ isDirectory: true })) // slug-b
      .mockResolvedValueOnce(makeStat({ mtime: 2 }));         // uuidLow file
    mockReadFile
      .mockResolvedValueOnce(jsonlHigh as unknown as Buffer)
      .mockResolvedValueOnce(jsonlLow as unknown as Buffer);

    const results = await searchSessions('deploy kubernetes');
    expect(results[0].cliSessionId).toBe(uuidHigh); // exact match (score 100) first
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it('caps results at 20', async () => {
    const uuids = Array.from({ length: 25 }, (_, i) =>
      `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`,
    );
    const slugs = uuids.map((_, i) => `slug-${i}`);

    mockReaddir.mockResolvedValueOnce(slugs as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    for (let i = 0; i < 25; i++) {
      mockReaddir.mockResolvedValueOnce([`${uuids[i]}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
      mockStat
        .mockResolvedValueOnce(makeStat({ isDirectory: true }))
        .mockResolvedValueOnce(makeStat({ mtime: i }));
      mockReadFile.mockResolvedValueOnce(
        makeJsonl([{ type: 'user', message: { content: 'find me please' } }]) as unknown as Buffer,
      );
    }

    const results = await searchSessions('find me');
    expect(results).toHaveLength(20);
  });

  it('uses cached entry when mtime is unchanged', async () => {
    const jsonl = makeJsonl([
      { cwd: '/repo' },
      { type: 'user', message: { content: 'cached content search' } },
    ]);
    const filePath = `/mock/home/.claude/projects/slug/${FAKE_UUID}.jsonl`;

    mockReaddir
      .mockResolvedValue(['slug'] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockReaddir
      .mockResolvedValueOnce(['slug'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce(['slug'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);

    mockStat
      .mockResolvedValue(makeStat({ isDirectory: true, mtime: 999 }));

    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    // First search — populates cache
    await searchSessions('cached content');
    // Second search — should use cache, not call readFile again
    await searchSessions('cached content');

    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('re-reads file when mtime changes', async () => {
    const jsonl = makeJsonl([
      { type: 'user', message: { content: 'updated content search' } },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['slug'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce(['slug'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);

    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 100 }))  // first search: mtime=100
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 200 })); // second search: mtime=200 (changed)

    mockReadFile
      .mockResolvedValueOnce(jsonl as unknown as Buffer)
      .mockResolvedValueOnce(jsonl as unknown as Buffer);

    await searchSessions('updated content');
    await searchSessions('updated content');

    expect(mockReadFile).toHaveBeenCalledTimes(2);
  });

  it('handles malformed JSONL lines gracefully', async () => {
    const jsonl = 'not json\n{"type":"user","message":{"content":"valid line"}}\n{broken';

    mockReaddir
      .mockResolvedValueOnce(['repo'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    // Should not throw; should find the valid user message
    const results = await searchSessions('valid line');
    expect(results).toHaveLength(1);
  });

  it('skips slugs when readdir fails', async () => {
    mockReaddir
      .mockResolvedValueOnce(['good-slug', 'bad-slug'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>) // good-slug files
      .mockRejectedValueOnce(new Error('EACCES'));  // bad-slug readdir fails

    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true })) // good-slug
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));         // file stat

    const jsonl = makeJsonl([{ type: 'user', message: { content: 'searchable text here' } }]);
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('searchable text');
    expect(results).toHaveLength(1);
    expect(results[0].projectSlug).toBe('good-slug');
  });

  it('snippet includes context around the match', async () => {
    const content = 'A'.repeat(70) + 'needle' + 'B'.repeat(70);
    const jsonl = makeJsonl([
      { cwd: '/repo' },
      { type: 'user', message: { content } },
    ]);

    mockReaddir
      .mockResolvedValueOnce(['repo'] as unknown as Awaited<ReturnType<typeof mockReaddir>>)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as unknown as Awaited<ReturnType<typeof mockReaddir>>);
    mockStat
      .mockResolvedValueOnce(makeStat({ isDirectory: true }))
      .mockResolvedValueOnce(makeStat({ mtime: 1 }));
    mockReadFile.mockResolvedValueOnce(jsonl as unknown as Buffer);

    const results = await searchSessions('needle');
    expect(results[0].snippet).toContain('needle');
    // Should be truncated with ellipsis since content is longer than snippet window
    expect(results[0].snippet).toMatch(/\u2026/);
  });
});
