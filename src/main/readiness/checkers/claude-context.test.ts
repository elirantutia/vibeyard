import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { claudeContextProducer } from './claude-context';
import type { AnalysisContext } from '../types';

vi.mock('fs');
vi.mock('child_process');

const mockFs = vi.mocked(fs);
const mockCp = vi.mocked(child_process);

beforeEach(() => {
  vi.resetAllMocks();
});

function makeCtx(trackedFiles: string[]): AnalysisContext {
  return { trackedFiles };
}

describe('claudeContextProducer', () => {
  it('returns tagged checks with context category', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = claudeContextProducer.produce('/test/project', makeCtx(['a.ts', 'b.ts']));

    expect(tagged).toHaveLength(2);
    expect(tagged.every(t => t.category === 'context')).toBe(true);
    expect(tagged.map(t => t.check.id)).toEqual(['claude-md-bloat', 'claudeignore']);
  });

  it('passes when no CLAUDE.md and small project', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = claudeContextProducer.produce('/test/project', makeCtx(['a.ts', 'b.ts', 'c.ts']));
    expect(tagged.every(t => t.check.status === 'pass')).toBe(true);
  });

  it('warns for CLAUDE.md between 300-500 lines', () => {
    const content = Array(400).fill('line').join('\n');
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('CLAUDE.md')) return content;
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = claudeContextProducer.produce('/test/project', makeCtx([]));
    const check = tagged.find(t => t.check.id === 'claude-md-bloat')!.check;
    expect(check.status).toBe('warning');
    expect(check.score).toBe(50);
  });

  it('fails for CLAUDE.md over 500 lines', () => {
    const content = Array(600).fill('line').join('\n');
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('CLAUDE.md')) return content;
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = claudeContextProducer.produce('/test/project', makeCtx([]));
    const check = tagged.find(t => t.check.id === 'claude-md-bloat')!.check;
    expect(check.status).toBe('fail');
    expect(check.score).toBe(0);
  });

  it('passes .claudeignore check for small projects without file', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const files = Array(50).fill(0).map((_, i) => `file${i}.ts`);
    const tagged = claudeContextProducer.produce('/test/project', makeCtx(files));
    const check = tagged.find(t => t.check.id === 'claudeignore')!.check;
    expect(check.status).toBe('pass');
  });

  it('fails .claudeignore check for small projects with sensitive files', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = claudeContextProducer.produce('/test/project', makeCtx(['src/index.ts', '.env', 'credentials.json']));
    const check = tagged.find(t => t.check.id === 'claudeignore')!.check;
    expect(check.status).toBe('fail');
    expect(check.description).toContain('sensitive files');
    expect(check.description).toContain('.env');
  });

  it('fails .claudeignore check for large projects without file', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const files = Array(300).fill(0).map((_, i) => `file${i}.ts`);
    const tagged = claudeContextProducer.produce('/test/project', makeCtx(files));
    const check = tagged.find(t => t.check.id === 'claudeignore')!.check;
    expect(check.status).toBe('fail');
  });

  it('passes .claudeignore check when file exists', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      if (String(p).endsWith('.claudeignore')) return { isFile: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });

    const files = Array(300).fill(0).map((_, i) => `file${i}.ts`);
    const tagged = claudeContextProducer.produce('/test/project', makeCtx(files));
    const check = tagged.find(t => t.check.id === 'claudeignore')!.check;
    expect(check.status).toBe('pass');
  });
});
