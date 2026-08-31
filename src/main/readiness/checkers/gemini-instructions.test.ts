import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { geminiInstructionsProducer } from './gemini-instructions';

import { makeAnalysisContext, mockInstructionFiles } from '../test-utils';

vi.mock('fs');

const mockFs = vi.mocked(fs);
const ctx = makeAnalysisContext();

beforeEach(() => {
  vi.resetAllMocks();
});

describe('geminiInstructionsProducer', () => {
  it('returns all fail when no files exist', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = geminiInstructionsProducer.produce('/test/project', ctx);

    expect(tagged).toHaveLength(5);
    expect(tagged.every(t => t.category === 'instructions')).toBe(true);
    expect(tagged.every(t => t.check.status === 'fail')).toBe(true);
  });

  it('uses gemini-md prefixed check IDs', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = geminiInstructionsProducer.produce('/test/project', ctx);
    const ids = tagged.map(t => t.check.id);
    expect(ids).toEqual([
      'gemini-md-exists',
      'gemini-md-build',
      'gemini-md-test',
      'gemini-md-architecture',
      'gemini-md-size',
    ]);
  });

  it('passes GEMINI.md exists check', () => {
    const content = Array(100).fill('# Line').join('\n') + '\n## Build\nnpm run build\n## Testing\nnpm test\n## Architecture\nSome overview';
    mockInstructionFiles(mockFs, { 'GEMINI.md': content });

    const tagged = geminiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'gemini-md-exists')!.check;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('detects build commands in GEMINI.md', () => {
    mockInstructionFiles(mockFs, { 'GEMINI.md': '## Build\nnpm run build\n' });

    const tagged = geminiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'gemini-md-build')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects test commands in GEMINI.md', () => {
    mockInstructionFiles(mockFs, { 'GEMINI.md': '## Testing\nnpm test\n' });

    const tagged = geminiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'gemini-md-test')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects architecture section in GEMINI.md', () => {
    mockInstructionFiles(mockFs, { 'GEMINI.md': '## Architecture\nThree-process Electron architecture\n' });

    const tagged = geminiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'gemini-md-architecture')!.check;
    expect(check.status).toBe('pass');
  });

  it('provides fix prompt for gemini-md-exists check', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = geminiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'gemini-md-exists')!.check;
    expect(check.status).toBe('fail');
    expect(check.fixPrompt).toBeTruthy();
    expect(check.fixPrompt).toContain('GEMINI.md');
  });
});
