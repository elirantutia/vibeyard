import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { sanitizeBackgroundImagePath, readBackgroundImageBuffer, readBackgroundImageAsDataUrl } from './background-image-read';

describe('background-image-read', () => {
  it('sanitize trims and strips double quotes', () => {
    expect(sanitizeBackgroundImagePath('  "/tmp/x.jpg"  ')).toBe('/tmp/x.jpg');
  });

  it('sanitize returns null for empty', () => {
    expect(sanitizeBackgroundImagePath('')).toBe(null);
    expect(sanitizeBackgroundImagePath('   ')).toBe(null);
  });

  it('reads a tiny file as buffer', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vy-bg-'));
    const filePath = path.join(dir, 't.png');
    await fs.writeFile(filePath, Buffer.from('hello'));
    const hit = await readBackgroundImageBuffer(filePath, undefined, { maxBytes: 1_000_000 });
    expect(hit?.mime).toBe('image/png');
    expect(Buffer.from(hit!.data).toString()).toBe('hello');
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('readBackgroundImageAsDataUrl wraps buffer read', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vy-bg2-'));
    const filePath = path.join(dir, 'x.png');
    await fs.writeFile(filePath, Buffer.from([0x41]));
    const url = await readBackgroundImageAsDataUrl(filePath, undefined, { maxBytes: 1_000_000 });
    expect(url).toMatch(/^data:image\/png;base64,/);
    await fs.rm(dir, { recursive: true, force: true });
  });
});
