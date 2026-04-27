import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  promises: { readFile: vi.fn(), readdir: vi.fn() },
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

    mockReadFile
      .mockResolvedValueOnce('/Users/me/dev/forty-api\n' as any) // .project_root
      .mockResolvedValueOnce(JSON.stringify({ sessionId: FULL_ID, messages: [] }) as any);

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
    mockReadFile.mockResolvedValueOnce(json as any);
    const r = await new GeminiProvider().indexTranscript('/p');
    expect(r.text).toContain('plain text prompt');
  });

  it('returns empty on parse failure', async () => {
    mockReadFile.mockResolvedValueOnce('{not json' as any);
    expect(await new GeminiProvider().indexTranscript('/p')).toEqual({ text: '', cwd: '' });
  });
});
