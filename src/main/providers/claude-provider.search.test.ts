import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  promises: { readFile: vi.fn(), readdir: vi.fn(), stat: vi.fn() },
}));
vi.mock('os', () => ({ homedir: () => '/mock/home' }));

// Heavy main-process deps imported by claude-provider that we don't exercise here.
vi.mock('../pty-manager', () => ({ getFullPath: () => '' }));
vi.mock('../hook-status', () => ({ installStatusLineScript: () => {}, cleanupAll: () => {} }));
vi.mock('../config-watcher', () => ({ startConfigWatcher: () => {}, stopConfigWatcher: () => {} }));
vi.mock('../claude-cli', () => ({ installHooksOnly: () => {}, installStatusLine: () => {}, getClaudeConfig: async () => ({}) }));
vi.mock('../settings-guard', () => ({ guardedInstall: async () => {}, validateSettings: () => ({}), reinstallSettings: () => {} }));
vi.mock('./resolve-binary', () => ({ resolveBinary: () => '', validateBinaryExists: () => true }));

import * as fs from 'fs';
import { ClaudeProvider } from './claude-provider';

const mockReadFile = vi.mocked(fs.promises.readFile);
const mockReaddir = vi.mocked(fs.promises.readdir);

const FAKE_UUID = '550e8400-e29b-41d4-a716-446655440000';

function dir(name: string) { return { name, isDirectory: () => true } as fs.Dirent; }
function file(name: string) { return { name, isDirectory: () => false } as fs.Dirent; }

function makeJsonl(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClaudeProvider.discoverTranscripts()', () => {
  it('returns [] when projects root is missing', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await new ClaudeProvider().discoverTranscripts()).toEqual([]);
  });

  it('lists every UUID-named JSONL across slugs', async () => {
    mockReaddir
      .mockResolvedValueOnce([dir('proj-a'), dir('proj-b')] as any)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`, 'history.jsonl'] as any)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as any);

    const out = await new ClaudeProvider().discoverTranscripts();
    expect(out).toHaveLength(2);
    expect(out[0].cliSessionId).toBe(FAKE_UUID);
    expect(out[0].projectSlug).toBe('proj-a');
    expect(out[0].transcriptPath).toMatch(/proj-a/);
  });

  it('skips non-directory entries and non-UUID filenames', async () => {
    mockReaddir
      .mockResolvedValueOnce([file('file.json'), dir('validslug')] as any)
      .mockResolvedValueOnce(['notes.jsonl', `${FAKE_UUID}.jsonl`] as any);

    const out = await new ClaudeProvider().discoverTranscripts();
    expect(out).toHaveLength(1);
    expect(out[0].projectSlug).toBe('validslug');
  });

  it('skips slugs whose readdir fails', async () => {
    mockReaddir
      .mockResolvedValueOnce([dir('ok'), dir('bad')] as any)
      .mockResolvedValueOnce([`${FAKE_UUID}.jsonl`] as any)
      .mockRejectedValueOnce(new Error('EACCES'));

    const out = await new ClaudeProvider().discoverTranscripts();
    expect(out).toHaveLength(1);
    expect(out[0].projectSlug).toBe('ok');
  });
});

describe('ClaudeProvider.indexTranscript()', () => {
  it('extracts user-message text and the first cwd it sees', async () => {
    const jsonl = makeJsonl([
      { cwd: '/Users/me/repo' },
      { type: 'user', message: { content: 'hello world' } },
      { type: 'assistant', message: { content: 'never indexed' } },
    ]);
    mockReadFile.mockResolvedValueOnce(jsonl as any);
    const r = await new ClaudeProvider().indexTranscript('/p');
    expect(r.cwd).toBe('/Users/me/repo');
    expect(r.text).toContain('hello world');
    expect(r.text).not.toContain('never indexed');
  });

  it('handles content as array of text blocks, ignoring non-text blocks', async () => {
    const jsonl = makeJsonl([
      { type: 'user', message: { content: [
        { type: 'text', text: 'refactor authentication' },
        { type: 'tool_use', id: 't1' },
      ] } },
    ]);
    mockReadFile.mockResolvedValueOnce(jsonl as any);
    const r = await new ClaudeProvider().indexTranscript('/p');
    expect(r.text).toContain('refactor authentication');
  });

  it('tolerates malformed JSONL lines', async () => {
    const jsonl = 'not json\n{"type":"user","message":{"content":"valid"}}\n{broken';
    mockReadFile.mockResolvedValueOnce(jsonl as any);
    const r = await new ClaudeProvider().indexTranscript('/p');
    expect(r.text).toContain('valid');
  });
});
