import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { aiInstructionsProducer } from './ai-instructions';
import type { AnalysisContext } from '../types';

vi.mock('fs');

const mockFs = vi.mocked(fs);
const ctx: AnalysisContext = { trackedFiles: [] };

beforeEach(() => {
  vi.resetAllMocks();
});

function mockFileExists(files: Record<string, string>): void {
  mockFs.statSync.mockImplementation((p: fs.PathLike) => {
    const filePath = String(p);
    for (const key of Object.keys(files)) {
      if (filePath.endsWith(key)) {
        return { isFile: () => true, isDirectory: () => false } as fs.Stats;
      }
    }
    throw new Error('ENOENT');
  });
  mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
    const filePath = String(p);
    for (const [key, content] of Object.entries(files)) {
      if (filePath.endsWith(key)) return content;
    }
    throw new Error('ENOENT');
  });
}

describe('aiInstructionsProducer', () => {
  it('returns all fail when no files exist', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);

    expect(tagged).toHaveLength(5);
    expect(tagged.every(t => t.category === 'instructions')).toBe(true);
    expect(tagged.every(t => t.check.status === 'fail')).toBe(true);
  });

  it('passes CLAUDE.md exists check', () => {
    const content = Array(100).fill('# Line').join('\n') + '\n## Build\nnpm run build\n## Testing\nnpm test\n## Architecture\nSome overview';
    mockFileExists({ 'CLAUDE.md': content });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-exists')!.check;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('detects build commands in CLAUDE.md', () => {
    mockFileExists({ 'CLAUDE.md': '## Build\nnpm run build\n' });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-build')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects test commands in CLAUDE.md', () => {
    mockFileExists({ 'CLAUDE.md': '## Testing\nnpm test\n' });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-test')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects architecture section in CLAUDE.md', () => {
    mockFileExists({ 'CLAUDE.md': '## Architecture\nThree-process Electron architecture\n' });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-architecture')!.check;
    expect(check.status).toBe('pass');
  });

  it('warns for small CLAUDE.md', () => {
    const content = Array(30).fill('line').join('\n');
    mockFileExists({ 'CLAUDE.md': content });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-size')!.check;
    expect(check.status).toBe('warning');
    expect(check.score).toBe(50);
  });

  it('passes for good size CLAUDE.md', () => {
    const content = Array(100).fill('line').join('\n');
    mockFileExists({ 'CLAUDE.md': content });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-size')!.check;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('fails for very large CLAUDE.md', () => {
    const content = Array(600).fill('line').join('\n');
    mockFileExists({ 'CLAUDE.md': content });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-size')!.check;
    expect(check.status).toBe('fail');
    expect(check.score).toBe(0);
  });

  it('provides fix prompt for claude-md-exists check', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-exists')!.check;
    expect(check.status).toBe('fail');
    expect(check.fixPrompt).toBeTruthy();
  });
});
