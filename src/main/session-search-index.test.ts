import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
const location = vi.hoisted(() => ({ dir: '' }));
vi.mock('electron', () => ({ app: { getPath: () => location.dir } }));
import { readSearchIndex, writeSearchIndex, pruneSearchIndex } from './session-search-index';

beforeEach(async () => { location.dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibeyard-index-')); });
afterEach(async () => { await fs.rm(location.dir, { recursive: true, force: true }); });

it('reuses a persisted index only for the matching source version', async () => {
  const record = { text: 'saved body', cwd: '/repo', mtime: 1, size: 5, ctime: 2 };
  await writeSearchIndex('claude', '/transcript', record);
  expect(await readSearchIndex('claude', '/transcript', record)).toEqual(record);
  expect(await readSearchIndex('claude', '/transcript', { ...record, size: 6 })).toBeNull();
  expect(await readSearchIndex('claude', '/transcript', { ...record, ctime: 3 })).toBeNull();
  expect(await readSearchIndex('pi', '/transcript', record)).toBeNull();
});

it('removes deleted sources without touching live indexes or unrelated files', async () => {
  const data = { text: 'body', cwd: '', mtime: 1 };
  await writeSearchIndex('claude', '/live', data);
  await writeSearchIndex('claude', '/deleted', data);
  const extra = path.join(location.dir, 'search-index-v2', 'claude', 'unrelated');
  await fs.writeFile(extra, 'keep');
  await pruneSearchIndex('claude', ['/live']);
  expect(await readSearchIndex('claude', '/live', data)).toEqual(data);
  expect(await readSearchIndex('claude', '/deleted', data)).toBeNull();
  expect(await fs.readFile(extra, 'utf8')).toBe('keep');
});
