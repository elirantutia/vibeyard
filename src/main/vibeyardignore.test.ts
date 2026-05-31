import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { loadScanIgnorePatterns, buildVibeyardignoreMatcher } from './vibeyardignore';

vi.mock('fs');

const mockFs = vi.mocked(fs);

/** Make readFileSync return `content` for `.vibeyardignore`, throw ENOENT otherwise. */
function mockVibeyardignore(content: string | null): void {
  mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
    if (String(p).endsWith('.vibeyardignore') && content !== null) return content;
    throw new Error('ENOENT');
  });
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('loadScanIgnorePatterns', () => {
  it('strips comments and blank lines', () => {
    mockVibeyardignore('# a comment\n\n*.min.js\n   \n  dist/  \n');
    expect(loadScanIgnorePatterns('/proj')).toEqual(['*.min.js', 'dist/']);
  });

  it('returns empty array when the file is missing', () => {
    mockVibeyardignore(null);
    expect(loadScanIgnorePatterns('/proj')).toEqual([]);
  });

  it('returns empty array when the file has only comments/blanks', () => {
    mockVibeyardignore('# only comments\n\n   \n');
    expect(loadScanIgnorePatterns('/proj')).toEqual([]);
  });
});

describe('buildVibeyardignoreMatcher', () => {
  it('matches basename globs', () => {
    mockVibeyardignore('*.min.js\n');
    const isIgnored = buildVibeyardignoreMatcher('/proj');
    expect(isIgnored('vendor/app.min.js')).toBe(true);
    expect(isIgnored('src/app.ts')).toBe(false);
  });

  it('matches full-path globs', () => {
    mockVibeyardignore('src/**/*.generated.ts\n');
    const isIgnored = buildVibeyardignoreMatcher('/proj');
    expect(isIgnored('src/api/types.generated.ts')).toBe(true);
    expect(isIgnored('lib/types.generated.ts')).toBe(false);
  });

  it('never ignores when the file is missing or empty', () => {
    mockVibeyardignore(null);
    const isIgnored = buildVibeyardignoreMatcher('/proj');
    expect(isIgnored('anything.min.js')).toBe(false);
  });
});
