import { vi, describe, it, expect, beforeEach } from 'vitest';
import * as path from 'path';
import { Readable } from 'stream';
import type { Stats, ReadStream } from 'fs';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  readdirSync: vi.fn(),
  openSync: vi.fn(),
  readSync: vi.fn(),
  closeSync: vi.fn(),
  createReadStream: vi.fn(),
  promises: { readFile: vi.fn(), readdir: vi.fn(), open: vi.fn(), stat: vi.fn() },
}));
vi.mock('os', () => ({ homedir: () => '/mock/home', tmpdir: () => '/tmp' }));
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
vi.mock('../pty-manager', () => ({ getFullPath: () => '' }));
vi.mock('./resolve-binary', () => ({ resolveBinary: () => '', validateBinaryExists: () => true }));

import * as fs from 'fs';
import { OmpProvider } from './omp-provider';

const mockExistsSync = vi.mocked(fs.existsSync);
const mockReaddirSync = vi.mocked(fs.readdirSync);
const mockOpenSync = vi.mocked(fs.openSync);
const mockReadSync = vi.mocked(fs.readSync);
const mockCloseSync = vi.mocked(fs.closeSync);
const mockReadFile = vi.mocked(fs.promises.readFile);
const mockReaddir = vi.mocked(fs.promises.readdir);
const mockOpen = vi.mocked(fs.promises.open);

const SID = '01a007b0-07e5-7eb4-b41b-438d945f89f3';
const header = (id: string, cwd: string) =>
  JSON.stringify({ type: 'session', version: 3, id, timestamp: '2026-08-15T23:09:32.005Z', cwd });
const FILE_NAME = `2026-08-15T23-09-32-005Z_${SID}.jsonl`;

beforeEach(() => { vi.clearAllMocks(); });

/** Make the bounded sync header reader (openSync/readSync/closeSync) serve `firstLine`. */
function mockSyncHeader(firstLine: string): void {
  mockOpenSync.mockReturnValue(42);
  mockReadSync.mockImplementation((_fd: number, target: Buffer) => {
    const buf = Buffer.from(firstLine);
    buf.copy(target);
    return buf.length;
  });
  mockCloseSync.mockReturnValue(true);
}

/** Make the bounded async header reader (promises.open) serve `firstLine`. */
function mockAsyncHeader(firstLine: string): void {
  mockOpen.mockResolvedValue({
    read: vi.fn(async (buf: Buffer) => {
      const b = Buffer.from(firstLine);
      b.copy(buf);
      return { bytesRead: b.length };
    }),
    close: vi.fn(async () => {}),
  } as any);
}

describe('OmpProvider.getTranscriptPath()', () => {
  it('matches the session header id and prefers an exact cwd', () => {
    mockReaddirSync
      .mockReturnValueOnce(['--C--Users-me--'] as any) // sessions/
      .mockReturnValueOnce([FILE_NAME] as any); // project dir
    mockSyncHeader(header(SID, 'C:\\Users\\me'));

    const p = new OmpProvider().getTranscriptPath(SID, 'C:\\Users\\me');
    expect(p).not.toBeNull();
    expect(p).toContain(FILE_NAME);
  });

  // S2: the old code fell back to a header match when the requested cwd did
  // not match, which handed back a transcript from a DIFFERENT project and
  // then cached that path for the session's whole life. The cwd match is now
  // authoritative — a mismatch resolves to null, never to a near miss.
  it('does not fall back to a header match when the cwd differs', () => {
    mockReaddirSync
      .mockReturnValueOnce(['--C--Users-me--'] as any)
      .mockReturnValueOnce([FILE_NAME] as any);
    mockSyncHeader(header(SID, 'C:\\Users\\elsewhere'));

    expect(new OmpProvider().getTranscriptPath(SID, 'C:\\Users\\me')).toBeNull();
  });

  it('skips files whose header id does not match', () => {
    mockReaddirSync
      .mockReturnValueOnce(['--C--Users-me--'] as any)
      .mockReturnValueOnce([FILE_NAME] as any);
    mockSyncHeader(header('other-id', 'C:\\Users\\me'));

    expect(new OmpProvider().getTranscriptPath(SID, 'C:\\Users\\me')).toBeNull();
  });

  it('returns null when the sessions root is missing', () => {
    mockExistsSync.mockReturnValueOnce(false);
    expect(new OmpProvider().getTranscriptPath(SID, 'C:\\Users\\me')).toBeNull();
  });

  it('honors a configDir override for the agent dir', () => {
    mockReaddirSync
      .mockReturnValueOnce(['--C--Users-me--'] as any)
      .mockReturnValueOnce([FILE_NAME] as any);
    mockSyncHeader(header(SID, 'C:\\Users\\me'));

    const p = new OmpProvider().getTranscriptPath(SID, 'C:\\Users\\me', '/profiles/work');
    expect(p).not.toBeNull();
    // The walk started under the overridden agent dir, not ~/.pi/agent
    expect(mockReaddirSync).toHaveBeenCalledWith(path.join('/profiles/work', 'sessions'));
  });
});

describe('OmpProvider.discoverTranscripts()', () => {
  it('emits a descriptor per .jsonl from the session header', async () => {
    mockReaddir
      .mockResolvedValueOnce(['--C--Users-me--'] as any) // sessions/
      .mockResolvedValueOnce([FILE_NAME, 'notes.txt'] as any); // project dir
    mockAsyncHeader(header(SID, 'C:\\Users\\me'));

    const out = await new OmpProvider().discoverTranscripts();
    expect(out).toHaveLength(1);
    expect(out[0].cliSessionId).toBe(SID);
    expect(out[0].projectCwd).toBe('C:\\Users\\me');
    expect(out[0].transcriptPath).toContain(FILE_NAME);
  });

  it('returns [] when the sessions root is missing', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await new OmpProvider().discoverTranscripts()).toEqual([]);
  });

  it('skips unreadable files', async () => {
    mockReaddir
      .mockResolvedValueOnce(['--C--Users-me--'] as any)
      .mockResolvedValueOnce([FILE_NAME] as any);
    mockOpen.mockRejectedValueOnce(new Error('EIO'));
    expect(await new OmpProvider().discoverTranscripts()).toEqual([]);
  });
});

describe('OmpProvider.indexTranscript()', () => {
  it('extracts user-typed text only, joining text blocks and capping at the char budget', async () => {
    const jsonl = [
      header(SID, 'C:\\Users\\me'),
      JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }),
      JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'never indexed' }] } }),
      JSON.stringify({ type: 'message', message: { role: 'user', content: 'plain follow-up' } }),
    ].join('\n');
    // The indexer streams the head window (createReadStream) after a size
    // guard (promises.stat), so both must be served.
    vi.mocked(fs.promises.stat).mockResolvedValueOnce(
      { size: jsonl.length } as unknown as Stats
    );
    vi.mocked(fs.createReadStream).mockReturnValueOnce(
      Readable.from([jsonl]) as unknown as ReadStream
    );

    const r = await new OmpProvider().indexTranscript('/p');
    expect(r.text).toContain('hi');
    expect(r.text).toContain('plain follow-up');
    expect(r.text).not.toContain('never indexed');
    expect(r.cwd).toBe('C:\\Users\\me');
  });

  it('returns empty on read failure', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await new OmpProvider().indexTranscript('/p')).toEqual({ text: '', cwd: '' });
  });
});
