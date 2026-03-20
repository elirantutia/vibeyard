import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { aiInstructionsChecker } from './ai-instructions';

vi.mock('fs');

const mockFs = vi.mocked(fs);

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

describe('aiInstructionsChecker', () => {
  it('returns all fail when no files exist', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await aiInstructionsChecker.analyze('/test/project');

    expect(result.id).toBe('ai-instructions');
    expect(result.weight).toBe(0.5);
    expect(result.score).toBe(0);
    expect(result.checks).toHaveLength(8);
    expect(result.checks.every(c => c.status === 'fail')).toBe(true);
  });

  it('passes CLAUDE.md exists check', async () => {
    const content = Array(100).fill('# Line').join('\n') + '\n## Build\nnpm run build\n## Testing\nnpm test\n## Architecture\nSome overview';
    mockFileExists({ 'CLAUDE.md': content });

    const result = await aiInstructionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-exists')!;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('detects build commands in CLAUDE.md', async () => {
    mockFileExists({ 'CLAUDE.md': '## Build\nnpm run build\n' });

    const result = await aiInstructionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-build')!;
    expect(check.status).toBe('pass');
  });

  it('detects test commands in CLAUDE.md', async () => {
    mockFileExists({ 'CLAUDE.md': '## Testing\nnpm test\n' });

    const result = await aiInstructionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-test')!;
    expect(check.status).toBe('pass');
  });

  it('detects architecture section in CLAUDE.md', async () => {
    mockFileExists({ 'CLAUDE.md': '## Architecture\nThree-process Electron architecture\n' });

    const result = await aiInstructionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-architecture')!;
    expect(check.status).toBe('pass');
  });

  it('warns for small CLAUDE.md', async () => {
    const content = Array(30).fill('line').join('\n');
    mockFileExists({ 'CLAUDE.md': content });

    const result = await aiInstructionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-size')!;
    expect(check.status).toBe('warning');
    expect(check.score).toBe(50);
  });

  it('passes for good size CLAUDE.md', async () => {
    const content = Array(100).fill('line').join('\n');
    mockFileExists({ 'CLAUDE.md': content });

    const result = await aiInstructionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-size')!;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('fails for very large CLAUDE.md', async () => {
    const content = Array(600).fill('line').join('\n');
    mockFileExists({ 'CLAUDE.md': content });

    const result = await aiInstructionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'claude-md-size')!;
    expect(check.status).toBe('fail');
    expect(check.score).toBe(0);
  });

  it('provides fix prompts for file existence checks', async () => {
    mockFs.statSync.mockImplementation(() => { throw new Error('ENOENT'); });
    mockFs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await aiInstructionsChecker.analyze('/test/project');
    // File existence checks (not dependent on CLAUDE.md content) should have fix prompts
    const fileChecks = ['claude-md-exists', 'cursor-rules', 'agents-md', 'copilot-instructions'];
    for (const id of fileChecks) {
      const check = result.checks.find(c => c.id === id)!;
      expect(check.status).toBe('fail');
      expect(check.fixPrompt).toBeTruthy();
    }
  });

  it('detects .cursorrules file', async () => {
    mockFileExists({ '.cursorrules': 'rules here' });

    const result = await aiInstructionsChecker.analyze('/test/project');
    const check = result.checks.find(c => c.id === 'cursor-rules')!;
    expect(check.status).toBe('pass');
  });

  it('calculates weighted score correctly', async () => {
    // 5 checks based on CLAUDE.md content pass, 3 file existence checks fail
    const content = Array(100).fill('line').join('\n') + '\nbuild\ntest\narchitecture\n';
    mockFileExists({ 'CLAUDE.md': content });

    const result = await aiInstructionsChecker.analyze('/test/project');
    // CLAUDE.md exists: pass(100), build: pass(100), test: pass(100), architecture: pass(100), size: pass(100)
    // cursorrules: fail(0), agents.md: fail(0), copilot: fail(0)
    expect(result.score).toBe(63); // 500/800 = 62.5, rounded to 63
  });
});
