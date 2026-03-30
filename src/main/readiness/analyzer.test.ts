import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as child_process from 'child_process';
import { analyzeReadiness } from './analyzer';

vi.mock('fs');
vi.mock('child_process');
vi.mock('../providers/registry', () => ({
  getAvailableProviderIds: vi.fn(() => ['claude']),
}));

import { getAvailableProviderIds } from '../providers/registry';

const mockFs = vi.mocked(fs);
const mockCp = vi.mocked(child_process);
const mockGetAvailable = vi.mocked(getAvailableProviderIds);

beforeEach(() => {
  vi.resetAllMocks();
  mockGetAvailable.mockReturnValue(['claude']);
  mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockFs.readdirSync.mockImplementation(() => { throw new Error('ENOENT'); });
  mockCp.execSync.mockReturnValue('');
});

describe('analyzeReadiness', () => {
  it('returns a valid result structure', async () => {
    const result = await analyzeReadiness('/test/project');

    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('categories');
    expect(result).toHaveProperty('scannedAt');
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
  });

  it('has valid ISO timestamp', async () => {
    const result = await analyzeReadiness('/test/project');
    expect(new Date(result.scannedAt).toISOString()).toBe(result.scannedAt);
  });

  it('weights sum to 1 with claude only', async () => {
    mockGetAvailable.mockReturnValue(['claude']);
    const result = await analyzeReadiness('/test/project');

    const totalWeight = result.categories.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0);
  });

  it('uses top-level category IDs when claude available', async () => {
    mockGetAvailable.mockReturnValue(['claude']);
    const result = await analyzeReadiness('/test/project');

    const ids = result.categories.map(c => c.id);
    expect(ids).toContain('instructions');
    expect(ids).toContain('context');
    expect(ids).toContain('optimizations');
  });

  it('uses top-level category IDs when codex available', async () => {
    mockGetAvailable.mockReturnValue(['codex']);
    const result = await analyzeReadiness('/test/project');

    const ids = result.categories.map(c => c.id);
    expect(ids).toContain('instructions');
    expect(ids).toContain('context');
    // codex has no optimizations checks
    expect(ids).not.toContain('optimizations');
  });

  it('weights sum to 1 with codex only', async () => {
    mockGetAvailable.mockReturnValue(['codex']);
    const result = await analyzeReadiness('/test/project');

    const totalWeight = result.categories.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0);
  });

  it('merges checks from both providers into shared categories', async () => {
    mockGetAvailable.mockReturnValue(['claude', 'codex']);
    const result = await analyzeReadiness('/test/project');

    const ids = result.categories.map(c => c.id);
    expect(ids).toContain('instructions');
    expect(ids).toContain('context');
    expect(ids).toContain('optimizations');

    // Instructions should contain checks from both providers
    const instructions = result.categories.find(c => c.id === 'instructions')!;
    const checkIds = instructions.checks.map(c => c.id);
    expect(checkIds).toContain('claude-md-exists');
    expect(checkIds).toContain('agents-md-exists');
  });

  it('weights sum to 1 with both providers', async () => {
    mockGetAvailable.mockReturnValue(['claude', 'codex']);
    const result = await analyzeReadiness('/test/project');

    const totalWeight = result.categories.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0);
  });

  it('includes only context category when no providers available', async () => {
    mockGetAvailable.mockReturnValue([]);
    const result = await analyzeReadiness('/test/project');

    const ids = result.categories.map(c => c.id);
    expect(ids).toEqual(['context']);
  });

  it('weights sum to 1 with no providers', async () => {
    mockGetAvailable.mockReturnValue([]);
    const result = await analyzeReadiness('/test/project');

    const totalWeight = result.categories.reduce((sum, c) => sum + c.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0);
  });

  it('calculates weighted overall score', async () => {
    const result = await analyzeReadiness('/test/project');

    const expected = Math.round(
      result.categories.reduce((sum, cat) => sum + cat.score * cat.weight, 0)
    );
    expect(result.overallScore).toBe(expected);
  });

  it('checks have providerIds set', async () => {
    mockGetAvailable.mockReturnValue(['claude', 'codex']);
    const result = await analyzeReadiness('/test/project');

    const instructions = result.categories.find(c => c.id === 'instructions')!;
    const claudeCheck = instructions.checks.find(c => c.id === 'claude-md-exists')!;
    expect(claudeCheck.providerIds).toEqual(['claude']);

    const codexCheck = instructions.checks.find(c => c.id === 'agents-md-exists')!;
    expect(codexCheck.providerIds).toEqual(['codex']);
  });
});
