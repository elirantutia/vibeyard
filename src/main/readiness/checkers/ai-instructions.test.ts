import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { aiInstructionsProducer } from './ai-instructions';
import { linesOf, makeAnalysisContext, mockInstructionFiles } from '../test-utils';

vi.mock('fs');

const mockFs = vi.mocked(fs);
const ctx = makeAnalysisContext();

beforeEach(() => {
  vi.resetAllMocks();
});

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
    mockInstructionFiles(mockFs, { 'CLAUDE.md': content });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-exists')!.check;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('detects build commands in CLAUDE.md', () => {
    mockInstructionFiles(mockFs, { 'CLAUDE.md': '## Build\nnpm run build\n' });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-build')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects test commands in CLAUDE.md', () => {
    mockInstructionFiles(mockFs, { 'CLAUDE.md': '## Testing\nnpm test\n' });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-test')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects architecture section in CLAUDE.md', () => {
    mockInstructionFiles(mockFs, { 'CLAUDE.md': '## Architecture\nThree-process Electron architecture\n' });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-architecture')!.check;
    expect(check.status).toBe('pass');
  });

  it('uses .claude/CLAUDE.md when root CLAUDE.md is missing', () => {
    mockInstructionFiles(mockFs, { [path.join('.claude', 'CLAUDE.md')]: '## Build\nnpm run build\n## Testing\nnpm test\n## Architecture\nReadiness architecture\n' });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);

    expect(tagged.find(t => t.check.id === 'claude-md-exists')!.check.status).toBe('pass');
    expect(tagged.find(t => t.check.id === 'claude-md-build')!.check.status).toBe('pass');
    expect(tagged.find(t => t.check.id === 'claude-md-test')!.check.status).toBe('pass');
    expect(tagged.find(t => t.check.id === 'claude-md-architecture')!.check.status).toBe('pass');
  });

  it('prefers root CLAUDE.md over .claude/CLAUDE.md when both exist', () => {
    mockInstructionFiles(mockFs, { 'CLAUDE.md': 'root only\n', [path.join('.claude', 'CLAUDE.md')]: '## Build\nnpm run build\n## Testing\nnpm test\n## Architecture\nDetailed\n' });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);

    expect(tagged.find(t => t.check.id === 'claude-md-build')!.check.status).toBe('fail');
    expect(tagged.find(t => t.check.id === 'claude-md-test')!.check.status).toBe('fail');
    expect(tagged.find(t => t.check.id === 'claude-md-architecture')!.check.status).toBe('fail');
  });

  it('warns for small CLAUDE.md', () => {
    const content = linesOf(30);
    mockInstructionFiles(mockFs, { 'CLAUDE.md': content });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-size')!.check;
    expect(check.status).toBe('warning');
    expect(check.score).toBe(50);
  });

  it('passes for good size CLAUDE.md', () => {
    const content = linesOf(100);
    mockInstructionFiles(mockFs, { 'CLAUDE.md': content });

    const tagged = aiInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'claude-md-size')!.check;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('fails for very large CLAUDE.md', () => {
    const content = linesOf(600);
    mockInstructionFiles(mockFs, { 'CLAUDE.md': content });

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

describe('aiInstructionsProducer nested CLAUDE.md', () => {
  function nestedChecks(trackedFiles: string[]) {
    return aiInstructionsProducer
      .produce('/test/project', makeAnalysisContext(trackedFiles))
      .map(t => t.check)
      .filter(c => c.id.startsWith('claude-md-size:'));
  }

  it('reports an oversized nested CLAUDE.md under its real path', () => {
    mockInstructionFiles(mockFs, { [path.join('apps', 'web', 'CLAUDE.md')]: linesOf(700) });

    const nested = nestedChecks(['apps/web/CLAUDE.md']);

    expect(nested).toHaveLength(1);
    expect(nested[0].id).toBe('claude-md-size:apps/web/CLAUDE.md');
    expect(nested[0].status).toBe('fail');
    expect(nested[0].description).toBe('apps/web/CLAUDE.md is 700 lines — too long, may waste context window.');
    expect(nested[0].fixPrompt).toContain('apps/web/CLAUDE.md');
  });

  it('does not treat the .claude/ fallback location as a nested file', () => {
    mockInstructionFiles(mockFs, { [path.join('.claude', 'CLAUDE.md')]: linesOf(700) });

    expect(nestedChecks(['.claude/CLAUDE.md'])).toHaveLength(0);
  });
});
