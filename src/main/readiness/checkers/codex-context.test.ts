import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { codexContextProducer } from './codex-context';
import type { AnalysisContext } from '../types';

vi.mock('fs');

const mockFs = vi.mocked(fs);
const ctx: AnalysisContext = { trackedFiles: [] };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('codexContextProducer', () => {
  it('returns tagged check with context category', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = codexContextProducer.produce('/test/project', ctx);

    expect(tagged).toHaveLength(1);
    expect(tagged[0].category).toBe('context');
    expect(tagged[0].check.id).toBe('agents-md-bloat');
  });

  it('passes when no AGENTS.md exists', () => {
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = codexContextProducer.produce('/test/project', ctx);
    expect(tagged[0].check.status).toBe('pass');
    expect(tagged[0].check.score).toBe(100);
  });

  it('passes for AGENTS.md under 300 lines', () => {
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('AGENTS.md')) return Array(200).fill('line').join('\n');
      throw new Error('ENOENT');
    });

    const tagged = codexContextProducer.produce('/test/project', ctx);
    expect(tagged[0].check.status).toBe('pass');
  });

  it('warns for AGENTS.md between 300-500 lines', () => {
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('AGENTS.md')) return Array(400).fill('line').join('\n');
      throw new Error('ENOENT');
    });

    const tagged = codexContextProducer.produce('/test/project', ctx);
    expect(tagged[0].check.status).toBe('warning');
    expect(tagged[0].check.score).toBe(50);
  });

  it('fails for AGENTS.md over 500 lines', () => {
    mockFs.readFileSync.mockImplementation((p: fs.PathOrFileDescriptor) => {
      if (String(p).endsWith('AGENTS.md')) return Array(600).fill('line').join('\n');
      throw new Error('ENOENT');
    });

    const tagged = codexContextProducer.produce('/test/project', ctx);
    expect(tagged[0].check.status).toBe('fail');
    expect(tagged[0].check.score).toBe(0);
    expect(tagged[0].check.fixPrompt).toBeTruthy();
  });
});
