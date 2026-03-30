import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { customExtensionsProducer } from './custom-extensions';
import type { AnalysisContext } from '../types';

vi.mock('fs');

const mockFs = vi.mocked(fs);
const ctx: AnalysisContext = { trackedFiles: [] };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('customExtensionsProducer', () => {
  it('returns all fail when no directories exist', () => {
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = customExtensionsProducer.produce('/test/project', ctx);

    expect(tagged).toHaveLength(3);
    expect(tagged.every(t => t.category === 'optimizations')).toBe(true);
    expect(tagged.every(t => t.check.status === 'fail')).toBe(true);
  });

  it('detects custom commands', () => {
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      const dirPath = String(p);
      if (dirPath.endsWith('commands')) return ['review.md', 'deploy.md'] as unknown as fs.Dirent[];
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = customExtensionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'custom-commands')!.check;
    expect(check.status).toBe('pass');
    expect(check.description).toContain('2 custom command');
  });

  it('detects custom skills (subdirectories)', () => {
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      const filePath = String(p);
      if (filePath.endsWith('skills') || filePath.endsWith('my-skill')) {
        return { isFile: () => false, isDirectory: () => true } as fs.Stats;
      }
      throw new Error('ENOENT');
    });
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      const dirPath = String(p);
      if (dirPath.endsWith('skills')) return ['my-skill'] as unknown as fs.Dirent[];
      throw new Error('ENOENT');
    });

    const tagged = customExtensionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'custom-skills')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects custom agents', () => {
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      const dirPath = String(p);
      if (dirPath.endsWith('agents')) return ['reviewer.md'] as unknown as fs.Dirent[];
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = customExtensionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'custom-agents')!.check;
    expect(check.status).toBe('pass');
  });

  it('provides fix prompts for failing checks', () => {
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const tagged = customExtensionsProducer.produce('/test/project', ctx);
    for (const t of tagged) {
      expect(t.check.fixPrompt).toBeTruthy();
    }
  });

  it('all checks pass when all directories have content', () => {
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      const filePath = String(p);
      if (filePath.endsWith('skills') || filePath.endsWith('my-skill')) {
        return { isFile: () => false, isDirectory: () => true } as fs.Stats;
      }
      throw new Error('ENOENT');
    });
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      const dirPath = String(p);
      if (dirPath.endsWith('commands')) return ['cmd.md'] as unknown as fs.Dirent[];
      if (dirPath.endsWith('skills')) return ['my-skill'] as unknown as fs.Dirent[];
      if (dirPath.endsWith('agents')) return ['agent.md'] as unknown as fs.Dirent[];
      throw new Error('ENOENT');
    });

    const tagged = customExtensionsProducer.produce('/test/project', ctx);
    expect(tagged.every(t => t.check.status === 'pass')).toBe(true);
    expect(tagged.every(t => t.check.score === 100)).toBe(true);
  });
});
