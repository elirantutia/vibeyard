import { describe, expect, it } from 'vitest';
import * as path from 'path';
import { resolvePathForMainProcess } from './project-fs-path';

describe('resolvePathForMainProcess', () => {
  it('trims whitespace before resolving', () => {
    const r = resolvePathForMainProcess('  /tmp/vibeyard-project-fs-path-test  ');
    expect(r).toBe(path.resolve('/tmp/vibeyard-project-fs-path-test'));
  });
});
