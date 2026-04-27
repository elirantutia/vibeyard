import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  promises: { readFile: vi.fn(), readdir: vi.fn() },
}));
vi.mock('os', () => ({ homedir: () => '/mock/home' }));

vi.mock('../pty-manager', () => ({ getFullPath: () => '' }));
vi.mock('../copilot-config', () => ({ getCopilotConfig: () => ({}) }));
vi.mock('../copilot-hooks', () => ({
  installCopilotHooks: () => {}, validateCopilotHooks: () => ({}), cleanupCopilotHooks: () => {}, SESSION_ID_VAR: 'COPILOT_SESSION_ID',
}));
vi.mock('../config-watcher', () => ({ startConfigWatcher: () => {}, stopConfigWatcher: () => {} }));
vi.mock('./resolve-binary', () => ({ resolveBinary: () => '', validateBinaryExists: () => true }));

import * as fs from 'fs';
import { CopilotProvider } from './copilot-provider';

const mockReadFile = vi.mocked(fs.promises.readFile);
const mockReaddir = vi.mocked(fs.promises.readdir);

const UUID = '54c23d7f-4fd6-4078-8a69-5eb73317a421';

function dir(name: string) { return { name, isDirectory: () => true } as fs.Dirent; }
function file(name: string) { return { name, isDirectory: () => false } as fs.Dirent; }

function makeJsonl(entries: object[]): string {
  return entries.map(e => JSON.stringify(e)).join('\n');
}

beforeEach(() => { vi.clearAllMocks(); });

describe('CopilotProvider.discoverTranscripts()', () => {
  it('uses dir name as cliSessionId and parses cwd from workspace.yaml', async () => {
    mockReaddir.mockResolvedValueOnce([dir(UUID), dir('not-a-uuid'), file('stray.txt')] as any);
    mockReadFile.mockResolvedValueOnce(
      'id: ' + UUID + '\ncwd: /Users/me/dev/repo\nsummary_count: 0\n' as any,
    );

    const out = await new CopilotProvider().discoverTranscripts();
    expect(out).toHaveLength(1);
    expect(out[0].cliSessionId).toBe(UUID);
    expect(out[0].projectCwd).toBe('/Users/me/dev/repo');
    expect(out[0].transcriptPath).toContain('events.jsonl');
  });

  it('still discovers when workspace.yaml is missing (cwd empty)', async () => {
    mockReaddir.mockResolvedValueOnce([dir(UUID)] as any);
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const out = await new CopilotProvider().discoverTranscripts();
    expect(out).toHaveLength(1);
    expect(out[0].projectCwd).toBe('');
  });

  it('returns [] when session-state root is missing', async () => {
    mockReaddir.mockRejectedValueOnce(new Error('ENOENT'));
    expect(await new CopilotProvider().discoverTranscripts()).toEqual([]);
  });
});

describe('CopilotProvider.indexTranscript()', () => {
  it('only extracts user.message data.content', async () => {
    const jsonl = makeJsonl([
      { type: 'session.start', data: {} },
      { type: 'user.message', data: { content: 'first prompt' } },
      { type: 'assistant.message', data: { content: 'never indexed' } },
      { type: 'user.message', data: { content: 'follow-up' } },
    ]);
    mockReadFile.mockResolvedValueOnce(jsonl as any);
    const r = await new CopilotProvider().indexTranscript('/p');
    expect(r.text).toContain('first prompt');
    expect(r.text).toContain('follow-up');
    expect(r.text).not.toContain('never indexed');
  });

  it('tolerates malformed lines', async () => {
    const jsonl = '{broken\n' + JSON.stringify({ type: 'user.message', data: { content: 'good prompt' } });
    mockReadFile.mockResolvedValueOnce(jsonl as any);
    const r = await new CopilotProvider().indexTranscript('/p');
    expect(r.text).toContain('good prompt');
  });
});
