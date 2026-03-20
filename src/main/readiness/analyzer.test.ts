import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { analyzeReadiness } from './analyzer';

vi.mock('fs');
vi.mock('child_process');

const mockFs = vi.mocked(fs);
const mockCp = vi.mocked(child_process);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('analyzeReadiness', () => {
  it('returns a valid result structure', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('');

    const result = await analyzeReadiness('/test/project');

    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('categories');
    expect(result).toHaveProperty('scannedAt');
    expect(result.categories).toHaveLength(3);
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('returns 3 categories with correct IDs', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('');

    const result = await analyzeReadiness('/test/project');

    expect(result.categories.map(c => c.id)).toEqual([
      'ai-instructions',
      'custom-extensions',
      'context-optimization',
    ]);
  });

  it('weights sum to 1', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('');

    const result = await analyzeReadiness('/test/project');

    const totalWeight = result.categories.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0);
  });

  it('calculates weighted overall score', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('');

    const result = await analyzeReadiness('/test/project');

    // All checkers should return 0 scores for missing files, except context-optimization
    // which may pass some checks. Overall should be weighted sum.
    const expected = Math.round(
      result.categories.reduce((sum, cat) => sum + cat.score * cat.weight, 0)
    );
    expect(result.overallScore).toBe(expected);
  });

  it('has valid ISO timestamp', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockCp.execSync.mockReturnValue('');

    const result = await analyzeReadiness('/test/project');

    expect(new Date(result.scannedAt).toISOString()).toBe(result.scannedAt);
  });
});
