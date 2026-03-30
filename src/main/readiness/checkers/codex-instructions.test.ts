import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { codexInstructionsProducer } from './codex-instructions';
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

describe('codexInstructionsProducer', () => {
  it('returns all fail when no files exist', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);

    expect(tagged).toHaveLength(5);
    expect(tagged.every(t => t.category === 'instructions')).toBe(true);
    expect(tagged.every(t => t.check.status === 'fail')).toBe(true);
  });

  it('uses agents-md prefixed check IDs', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const ids = tagged.map(t => t.check.id);
    expect(ids).toEqual([
      'agents-md-exists',
      'agents-md-build',
      'agents-md-test',
      'agents-md-architecture',
      'agents-md-size',
    ]);
  });

  it('passes AGENTS.md exists check', () => {
    const content = Array(100).fill('# Line').join('\n') + '\n## Build\nnpm run build\n## Testing\nnpm test\n## Architecture\nSome overview';
    mockFileExists({ 'AGENTS.md': content });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-exists')!.check;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('detects build commands in AGENTS.md', () => {
    mockFileExists({ 'AGENTS.md': '## Build\nnpm run build\n' });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-build')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects test commands in AGENTS.md', () => {
    mockFileExists({ 'AGENTS.md': '## Testing\nnpm test\n' });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-test')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects architecture section in AGENTS.md', () => {
    mockFileExists({ 'AGENTS.md': '## Architecture\nThree-process Electron architecture\n' });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-architecture')!.check;
    expect(check.status).toBe('pass');
  });

  it('warns for small AGENTS.md', () => {
    const content = Array(30).fill('line').join('\n');
    mockFileExists({ 'AGENTS.md': content });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-size')!.check;
    expect(check.status).toBe('warning');
    expect(check.score).toBe(50);
  });

  it('passes for good size AGENTS.md', () => {
    const content = Array(100).fill('line').join('\n');
    mockFileExists({ 'AGENTS.md': content });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-size')!.check;
    expect(check.status).toBe('pass');
  });

  it('provides fix prompt for agents-md-exists check', () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-exists')!.check;
    expect(check.status).toBe('fail');
    expect(check.fixPrompt).toBeTruthy();
    expect(check.fixPrompt).toContain('AGENTS.md');
  });
});
