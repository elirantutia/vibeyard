import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  readdirSync: vi.fn(() => []),
  createReadStream: vi.fn(),
  promises: { readFile: vi.fn(), readdir: vi.fn(), stat: vi.fn() },
}));
vi.mock('os', () => ({ homedir: () => '/mock/home' }));

vi.mock('../pty-manager', () => ({ getFullPath: () => '' }));
vi.mock('../codex-config', () => ({ getCodexConfig: async () => ({}) }));
vi.mock('../codex-hooks', () => ({
  installCodexHooks: () => {}, validateCodexHooks: () => ({}), cleanupCodexHooks: () => {}, SESSION_ID_VAR: 'CODEX_SESSION_ID',
}));
vi.mock('../config-watcher', () => ({ startConfigWatcher: () => {}, stopConfigWatcher: () => {} }));
vi.mock('../codex-session-watcher', () => ({
  startCodexSessionWatcher: vi.fn(),
  registerPendingCodexSession: vi.fn(),
  unregisterCodexSession: vi.fn(),
}));
vi.mock('./resolve-binary', () => ({ resolveBinary: () => '', validateBinaryExists: () => true }));

import * as fs from 'fs';
import { Readable } from 'stream';
import { CodexProvider } from './codex-provider';

const mockReadFile = vi.mocked(fs.promises.readFile);
const mockReaddir = vi.mocked(fs.promises.readdir);

const UUID = '019d3512-caf9-7b50-8d2b-ccccdcf8ff14';

function dir(name: string) { return { name, isDirectory: () => true } as fs.Dirent; }
function file(name: string) { return { name, isDirectory: () => false } as fs.Dirent; }

function makeJsonl(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n');
}

function mockIndexFile(jsonl: string): void {
  vi.mocked(fs.promises.stat).mockResolvedValueOnce({ size: Buffer.byteLength(jsonl) } as fs.Stats);
  vi.mocked(fs.createReadStream).mockReturnValueOnce(Readable.from([jsonl]) as fs.ReadStream);
}

beforeEach(() => { vi.clearAllMocks(); });

describe('CodexProvider.discoverTranscripts()', () => {
  it('walks YYYY/MM/DD and parses cliSessionId from filename suffix', async () => {
    // Walker uses readdir withFileTypes at each level; depth 3 enumerates files.
    mockReaddir
      .mockResolvedValueOnce([dir('2026')] as any)
      .mockResolvedValueOnce([dir('03')] as any)
      .mockResolvedValueOnce([dir('28')] as any)
      .mockResolvedValueOnce([
        file(`rollout-2026-03-28T18-31-57-${UUID}.jsonl`),
        file('README.md'),
      ] as any);

    const out = await new CodexProvider().discoverTranscripts();
    expect(out).toHaveLength(1);
    expect(out[0].cliSessionId).toBe(UUID);
    expect(out[0].transcriptPath).toContain(`rollout-2026-03-28T18-31-57-${UUID}.jsonl`);
  });

  it('returns [] when root is missing', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await new CodexProvider().discoverTranscripts()).toEqual([]);
  });
});

describe('CodexProvider.indexTranscript()', () => {
  it('pulls cwd from session_meta and user text from response_item with role=user', async () => {
    const jsonl = makeJsonl([
      { type: 'session_meta', payload: { cwd: '/Users/me/repo', id: UUID } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'fix the bug' },
      ] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [
        { type: 'output_text', text: 'never indexed' },
      ] } },
    ]);
    mockIndexFile(jsonl);
    const r = await new CodexProvider().indexTranscript('/p');
    expect(r.cwd).toBe('/Users/me/repo');
    expect(r.text).toContain('fix the bug');
    expect(r.text).not.toContain('never indexed');
  });

  it('concatenates multiple input_text blocks', async () => {
    const jsonl = makeJsonl([
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [
        { type: 'input_text', text: 'part one' },
        { type: 'input_text', text: 'part two' },
      ] } },
    ]);
    mockIndexFile(jsonl);
    const r = await new CodexProvider().indexTranscript('/p');
    expect(r.text).toContain('part one');
    expect(r.text).toContain('part two');
  });
});
