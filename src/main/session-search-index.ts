import { app } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';

// Derived local data, not conversation history. Bump the directory version when
// extraction semantics change. One capped record per source, never loaded as a corpus.
interface Version { mtime: number; size?: number; ctime?: number }
interface RecordData extends Version { text: string; cwd: string }
const MAX_TEXT = 50 * 1024;
const MAX_RECORD_BYTES = MAX_TEXT * 6 + 32 * 1024;
function directory(provider: string): string {
  if (!/^[a-z-]+$/.test(provider)) throw new Error('Invalid provider');
  return path.join(app.getPath('userData'), 'search-index-v2', provider);
}
function key(source: string): string { return createHash('sha256').update(source).digest('hex') + '.json'; }

export async function readSearchIndex(provider: string, source: string, version: Version): Promise<RecordData | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(path.join(directory(provider), key(source)), 'r');
    const size = (await handle.stat()).size;
    if (size > MAX_RECORD_BYTES) return null;
    const buffer = Buffer.alloc(size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const read = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!read.bytesRead) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > size) return null;
    const data = JSON.parse(buffer.toString('utf8', 0, bytesRead)) as RecordData;
    if (data.mtime !== version.mtime || data.size !== version.size || data.ctime !== version.ctime ||
        typeof data.text !== 'string' || data.text.length > MAX_TEXT || typeof data.cwd !== 'string') return null;
    return data;
  } catch { return null; }
  finally { await handle?.close().catch(() => {}); }
}

export async function writeSearchIndex(provider: string, source: string, data: RecordData): Promise<void> {
  let temporary: string | undefined;
  try {
    const dir = directory(provider);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const output = JSON.stringify({ ...data, text: data.text.slice(0, MAX_TEXT) });
    if (Buffer.byteLength(output) > MAX_RECORD_BYTES) return;
    const target = path.join(dir, key(source));
    temporary = target + '.' + randomUUID() + '.tmp';
    await fs.writeFile(temporary, output, { mode: 0o600 });
    await fs.rename(temporary, target);
  } catch { /* Search remains available when the cache cannot be written. */ }
  finally { if (temporary) await fs.unlink(temporary).catch(() => {}); }
}

export async function pruneSearchIndex(provider: string, sources: string[]): Promise<void> {
  try {
    const dir = directory(provider);
    const live = new Set(sources.map(key));
    for (const name of await fs.readdir(dir)) {
      if (/^[a-f0-9]{64}\.json$/.test(name) && !live.has(name)) await fs.unlink(path.join(dir, name)).catch(() => {});
    }
  } catch { /* Missing cache or unavailable filesystem. */ }
}
