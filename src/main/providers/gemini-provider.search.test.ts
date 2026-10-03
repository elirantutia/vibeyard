import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  promises: { readFile: vi.fn(), readdir: vi.fn(), stat: vi.fn(), open: vi.fn() },
}));
vi.mock('os', () => ({ homedir: () => '/mock/home' }));

vi.mock('../pty-manager', () => ({ getFullPath: () => '' }));
vi.mock('../gemini-config', () => ({ getGeminiConfig: async () => ({}) }));
vi.mock('../gemini-hooks', () => ({
  installGeminiHooks: () => {}, validateGeminiHooks: () => ({}), cleanupGeminiHooks: () => {}, SESSION_ID_VAR: 'GEMINI_SESSION_ID',
}));
vi.mock('../config-watcher', () => ({ startConfigWatcher: () => {}, stopConfigWatcher: () => {} }));
vi.mock('./resolve-binary', () => ({ resolveBinary: () => '', validateBinaryExists: () => true }));

import * as fs from 'fs';
import { GeminiProvider } from './gemini-provider';

const mockReadFile = vi.mocked(fs.promises.readFile);
const mockReaddir = vi.mocked(fs.promises.readdir);

const FULL_ID = 'a840aafb-e00e-46b2-b8d4-1abedbb72ab1';
const SHORT = FULL_ID.slice(0, 8);

beforeEach(() => { vi.clearAllMocks(); });

describe('GeminiProvider.discoverTranscripts()', () => {
  it('reads .project_root for cwd and pulls full sessionId from JSON body, not the 8-char filename', async () => {
    mockReaddir
      .mockResolvedValueOnce(['my-project-key'] as any) // tmp/
      .mockResolvedValueOnce([`session-2026-03-31T15-54-${SHORT}.json`, 'irrelevant.txt'] as any); // chats/

    const source = JSON.stringify({ sessionId: FULL_ID, messages: [] });
    mockReadFile
      .mockResolvedValueOnce('/Users/me/dev/forty-api\n' as any) // .project_root
      .mockResolvedValueOnce(source as any);
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: source.length } as fs.Stats);

    const out = await new GeminiProvider().discoverTranscripts();
    expect(out).toHaveLength(1);
    expect(out[0].cliSessionId).toBe(FULL_ID);
    expect(out[0].projectCwd).toBe('/Users/me/dev/forty-api');
    expect(out[0].projectSlug).toBe('my-project-key');
    expect(out[0].transcriptPath).toContain(`session-2026-03-31T15-54-${SHORT}.json`);
  });

  it('skips project keys missing .project_root', async () => {
    mockReaddir.mockResolvedValueOnce(['orphan'] as any);
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await new GeminiProvider().discoverTranscripts()).toEqual([]);
  });
});

describe('GeminiProvider.discoverTranscripts() read bounds', () => {
  it('skips transcripts above the indexer size limit without reading them', async () => {
    mockReaddir
      .mockResolvedValueOnce(['proj'] as any) // tmp/
      .mockResolvedValueOnce(['session-2026-01-01T00-00-aaaaaaaa.json'] as any); // chats/
    mockReadFile.mockResolvedValueOnce('/repo\n' as any); // .project_root
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 100 * 1024 * 1024 } as fs.Stats);

    const out = await new GeminiProvider().discoverTranscripts();
    expect(out).toEqual([]);
    // Only the .project_root read happened — the oversized transcript was
    // never read, only stat-ed.
    expect(mockReadFile).toHaveBeenCalledTimes(1);
    expect(mockReadFile.mock.calls[0][0]).toContain('.project_root');
  });

  it('reads only a bounded header to extract the id of a large transcript', async () => {
    const header = JSON.stringify({ sessionId: FULL_ID, messages: [] });
    const size = header.length + 1024 * 1024; // > 64 KiB window
    const read = vi.fn(async (buf: Buffer, offset: number, length: number) => {
      const bytes = Buffer.from(header).subarray(0, Math.min(length, header.length));
      bytes.copy(buf, offset);
      return { bytesRead: bytes.length, buffer: buf };
    });
    const close = vi.fn(async () => {});
    mockReaddir
      .mockResolvedValueOnce(['proj'] as any) // tmp/
      .mockResolvedValueOnce(['session-2026-01-01T00-00-aaaaaaaa.json'] as any); // chats/
    mockReadFile.mockResolvedValueOnce('/repo\n' as any); // .project_root
    vi.mocked(fs.promises.stat).mockResolvedValue({ size } as fs.Stats);
    vi.mocked(fs.promises.open).mockResolvedValue({ read, close } as any);

    const out = await new GeminiProvider().discoverTranscripts();
    expect(out).toHaveLength(1);
    expect(out[0].cliSessionId).toBe(FULL_ID);
    expect(read).toHaveBeenCalledTimes(1);
    // The single read requests exactly the 64 KiB header window, and no
    // full-content read happens for the transcript.
    expect(read.mock.calls[0][2]).toBe(64 * 1024);
    expect(close).toHaveBeenCalledTimes(1);
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it('re-discovers unchanged small transcripts with bounded reads only', async () => {
    const source = JSON.stringify({ sessionId: FULL_ID, messages: [] });
    mockReaddir.mockImplementation(((dir: any) =>
      String(dir).endsWith('chats') ? ['session-2026-01-01T00-00-aaaaaaaa.json'] : ['proj']) as any);
    mockReadFile.mockImplementation(async (file: any) =>
      String(file).endsWith('.project_root') ? '/repo\n' : source);
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: source.length } as fs.Stats);

    for (let i = 0; i < 2; i++) {
      const out = await new GeminiProvider().discoverTranscripts();
      expect(out).toHaveLength(1);
      expect(out[0].cliSessionId).toBe(FULL_ID);
    }
    // Each discovery stat-s the file and reads at most the header window
    // (the whole small file here) — never an unbounded whole-transcript read.
    expect(vi.mocked(fs.promises.stat)).toHaveBeenCalledTimes(2);
    const transcriptReads = mockReadFile.mock.calls.filter(c => String(c[0]).endsWith('.json'));
    expect(transcriptReads).toHaveLength(2);
    for (const call of transcriptReads) {
      expect(Buffer.byteLength(String(mockReadFile.mock.results[transcriptReads.indexOf(call)].value))).toBeLessThanOrEqual(64 * 1024);
    }
  });
});

describe('GeminiProvider.indexTranscript() budget', () => {
  it('keeps the joined text within the persisted index cap, separators included', async () => {
    // 999 messages of 50 chars plus a final boundary message: the old
    // accounting joined past 51,200 chars and the disk index sliced it.
    const messages = Array.from({ length: 999 }, () => ({ type: 'user', content: 'x'.repeat(50) }));
    messages.push({ type: 'user', content: 'needle' });
    const json = JSON.stringify({ sessionId: FULL_ID, messages });
    vi.mocked(fs.promises.stat).mockResolvedValueOnce({ size: Buffer.byteLength(json) } as fs.Stats);
    mockReadFile.mockResolvedValueOnce(json as any);

    const r = await new GeminiProvider().indexTranscript('/p');
    expect(r.text.length).toBeLessThanOrEqual(50 * 1024);
    // The budget is boundary-tight: most of the 50 KiB cap is used.
    expect(r.text.length).toBeGreaterThan(50 * 1024 - 512);
  });

  it('fits a boundary-length message when the budget allows it', async () => {
    // 900 messages of 50 chars leave room for the final message once the
    // separators are charged.
    const messages = Array.from({ length: 900 }, () => ({ type: 'user', content: 'x'.repeat(50) }));
    messages.push({ type: 'user', content: 'needle' });
    const json = JSON.stringify({ sessionId: FULL_ID, messages });
    vi.mocked(fs.promises.stat).mockResolvedValueOnce({ size: Buffer.byteLength(json) } as fs.Stats);
    mockReadFile.mockResolvedValueOnce(json as any);

    const r = await new GeminiProvider().indexTranscript('/p');
    expect(r.text).toContain('needle');
    expect(r.text.length).toBeLessThanOrEqual(50 * 1024);
  });
});

describe('GeminiProvider.indexTranscript()', () => {
  it('extracts user-typed text only, joining multi-block content', async () => {
    const json = JSON.stringify({
      sessionId: FULL_ID,
      messages: [
        { type: 'user', content: [{ text: 'hey' }] },
        { type: 'gemini', content: 'never indexed' },
        { type: 'user', content: [{ text: 'follow-up question' }] },
      ],
    });
    vi.mocked(fs.promises.stat).mockResolvedValueOnce({ size: Buffer.byteLength(json) } as fs.Stats);
    mockReadFile.mockResolvedValueOnce(json as any);

    const r = await new GeminiProvider().indexTranscript('/p');
    expect(r.text).toContain('hey');
    expect(r.text).toContain('follow-up question');
    expect(r.text).not.toContain('never indexed');
  });

  it('handles user content as plain string', async () => {
    const json = JSON.stringify({
      sessionId: FULL_ID,
      messages: [{ type: 'user', content: 'plain text prompt' }],
    });
    vi.mocked(fs.promises.stat).mockResolvedValueOnce({ size: Buffer.byteLength(json) } as fs.Stats);
    mockReadFile.mockResolvedValueOnce(json as any);
    const r = await new GeminiProvider().indexTranscript('/p');
    expect(r.text).toContain('plain text prompt');
  });

  it('returns empty on parse failure', async () => {
    vi.mocked(fs.promises.stat).mockResolvedValueOnce({ size: 9 } as fs.Stats);
    mockReadFile.mockResolvedValueOnce('{not json' as any);
    expect(await new GeminiProvider().indexTranscript('/p')).toEqual({ text: '', cwd: '' });
  });
});
