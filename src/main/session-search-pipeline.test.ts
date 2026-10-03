import { vi, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type * as OsModule from 'os';
// R-01 regression: first read, memory hit and disk hit must search the
// identical string. Uses the real Gemini indexer, the real search
// coordinator and the real disk index in dedicated temp dirs.
const location = vi.hoisted(() => ({ home: '', userData: '' }));
vi.mock('electron', () => ({ app: { getPath: () => location.userData } }));
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof OsModule>();
  return { ...actual, homedir: () => location.home };
});
vi.mock('../gemini-config', () => ({ getGeminiConfig: async () => ({}) }));
vi.mock('../gemini-hooks', () => ({
  installGeminiHooks: () => {}, validateGeminiHooks: () => ({}), cleanupGeminiHooks: () => {}, SESSION_ID_VAR: 'GEMINI_SESSION_ID',
}));
vi.mock('../config-watcher', () => ({ startConfigWatcher: () => {}, stopConfigWatcher: () => {} }));
vi.mock('./resolve-binary', () => ({ resolveBinary: () => '', validateBinaryExists: () => true }));
const providersForTest: unknown[] = [];
vi.mock('./providers/registry', () => ({
  getAllProviders: () => providersForTest,
}));

import { GeminiProvider } from './providers/gemini-provider';
import { searchSessions, _resetForTesting } from './session-deep-search';
import { readSearchIndex } from './session-search-index';

const FULL_ID = 'a840aafb-e00e-46b2-b8d4-1abedbb72ab1';
const MAX_TEXT = 50 * 1024;

/** 999 messages of 50 chars plus a final boundary message (~55 KiB joined). */
async function writeFixture(): Promise<string> {
  const projectDir = path.join(location.home, '.gemini', 'tmp', 'proj-key');
  const chatsDir = path.join(projectDir, 'chats');
  await fs.mkdir(chatsDir, { recursive: true });
  await fs.writeFile(path.join(projectDir, '.project_root'), '/repo\n');
  const messages = Array.from({ length: 999 }, () => ({ type: 'user', content: 'x'.repeat(50) }));
  messages.push({ type: 'user', content: 'needle' });
  const fixturePath = path.join(chatsDir, `session-2026-01-01T00-00-${FULL_ID.slice(0, 8)}.json`);
  await fs.writeFile(fixturePath, JSON.stringify({ sessionId: FULL_ID, messages }));
  return fixturePath;
}

beforeEach(async () => {
  location.home = await fs.mkdtemp(path.join(os.tmpdir(), 'vibeyard-pipeline-home-'));
  location.userData = await fs.mkdtemp(path.join(os.tmpdir(), 'vibeyard-pipeline-data-'));
  providersForTest.length = 0;
  providersForTest.push(new GeminiProvider());
  _resetForTesting();
});

afterEach(async () => {
  await fs.rm(location.home, { recursive: true, force: true });
  await fs.rm(location.userData, { recursive: true, force: true });
});

it('indexes many short messages plus a boundary message to at most the persisted cap', async () => {
  const fixturePath = await writeFixture();
  const indexed = await new GeminiProvider().indexTranscript(fixturePath);
  expect(indexed.text.length).toBeLessThanOrEqual(MAX_TEXT);
});

it('searches the identical string on first read, memory hit and disk hit', async () => {
  const fixturePath = await writeFixture();
  const first = await searchSessions('xxxx');
  expect(first).toHaveLength(1);
  expect(first[0].cliSessionId).toBe(FULL_ID);

  // The first search persisted the index; evict the memory cache so the
  // next search reloads the disk record.
  _resetForTesting();
  const reloaded = await searchSessions('xxxx');
  expect(reloaded).toHaveLength(first.length);
  expect(reloaded[0].cliSessionId).toBe(first[0].cliSessionId);

  // The persisted record is the exact string the indexer produced — the
  // slice in writeSearchIndex is a no-op defense, not a transformation.
  const stat = await fs.stat(fixturePath);
  const record = await readSearchIndex('gemini', fixturePath, { mtime: stat.mtimeMs, size: stat.size, ctime: stat.ctimeMs });
  expect(record).not.toBeNull();
  expect(record!.text.length).toBeLessThanOrEqual(MAX_TEXT);
  expect(record!.text).toBe((await new GeminiProvider().indexTranscript(fixturePath)).text);
});

it('returns equal results before and after a memory reset for a budget-dropped message', async () => {
  await writeFixture();
  const before = await searchSessions('needle');
  _resetForTesting();
  const after = await searchSessions('needle');
  expect(after.length).toBe(before.length);
});
