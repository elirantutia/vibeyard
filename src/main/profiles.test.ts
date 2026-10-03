import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { provisionProfileDir } from './profiles';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('provisionProfileDir isolation', () => {
  it('rejects two profiles of the same provider sharing a config directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vibeyard-profiles-test-'));
    dirs.push(root);
    const configDir = path.join(root, 'shared');
    provisionProfileDir('first', configDir, 'claude');
    expect(() => provisionProfileDir('second', configDir, 'claude', [
      { id: 'first', providerId: 'claude', configDir },
    ])).toThrow(/already used/);
    expect(provisionProfileDir('first', configDir, 'claude', [
      { id: 'first', providerId: 'claude', configDir },
    ])).toBe(configDir);
  });
});
