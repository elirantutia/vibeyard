import { describe, it, expect } from 'vitest';
import { buildSplitFilesPrompt } from './split-file-prompt';

describe('buildSplitFilesPrompt', () => {
  it('uses singular wording for a single file', () => {
    const prompt = buildSplitFilesPrompt(['src/big.ts']);
    expect(prompt).toContain('src/big.ts');
    expect(prompt).toContain('This file is very large');
    expect(prompt).toContain('Split it into smaller, focused modules.');
  });

  it('uses plural wording and joins multiple files', () => {
    const prompt = buildSplitFilesPrompt(['a.ts', 'b.ts']);
    expect(prompt).toContain('a.ts, b.ts');
    expect(prompt).toContain('These files are very large');
    expect(prompt).toContain('Split them into smaller, focused modules.');
  });
});
