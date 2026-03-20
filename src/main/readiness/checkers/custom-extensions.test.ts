import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { customExtensionsChecker } from './custom-extensions';

vi.mock('fs');

const mockFs = vi.mocked(fs);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('customExtensionsChecker', () => {
  it('returns all fail when no directories exist', async () => {
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await customExtensionsChecker.analyze('/test/project');

    expect(result.id).toBe('custom-extensions');
    expect(result.weight).toBe(0.3);
    expect(result.score).toBe(0);
    expect(result.checks).toHaveLength(3);
    expect(result.checks.every(c => c.status === 'fail')).toBe(true);
  });

  it('detects custom commands', async () => {
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      const dirPath = String(p);
      if (dirPath.endsWith('commands')) return ['review.md', 'deploy.md'] as unknown as fs.Dirent[];
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await customExtensionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'custom-commands')!;
    expect(check.status).toBe('pass');
    expect(check.description).toContain('2 custom command');
  });

  it('detects custom skills (subdirectories)', async () => {
    mockFs.statSync.mockImplementation((p: fs.PathLike) => {
      const filePath = String(p);
      if (filePath.endsWith('skills')) return { isFile: () => false, isDirectory: () => true } as fs.Stats;
      if (filePath.endsWith('my-skill')) return { isFile: () => false, isDirectory: () => true } as fs.Stats;
      throw new Error('ENOENT');
    });
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      const dirPath = String(p);
      if (dirPath.endsWith('skills')) return ['my-skill'] as unknown as fs.Dirent[];
      throw new Error('ENOENT');
    });

    const result = await customExtensionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'custom-skills')!;
    expect(check.status).toBe('pass');
  });

  it('detects custom agents', async () => {
    mockFs.readdirSync.mockImplementation((p: fs.PathLike) => {
      const dirPath = String(p);
      if (dirPath.endsWith('agents')) return ['reviewer.md'] as unknown as fs.Dirent[];
      throw new Error('ENOENT');
    });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await customExtensionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'custom-agents')!;
    expect(check.status).toBe('pass');
  });

  it('provides fix prompts for failing checks', async () => {
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await customExtensionsChecker.analyze('/test/project');
    for (const check of result.checks) {
      expect(check.fixPrompt).toBeTruthy();
    }
  });

  it('calculates score as 100 when all pass', async () => {
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

    const result = await customExtensionsChecker.analyze('/test/project');
    expect(result.score).toBe(100);
  });
});
