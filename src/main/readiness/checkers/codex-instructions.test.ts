import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { codexInstructionsProducer } from './codex-instructions';
import { linesOf, makeAnalysisContext, mockInstructionFiles } from '../test-utils';

vi.mock('fs');

const mockFs = vi.mocked(fs);
const ctx = makeAnalysisContext();

beforeEach(() => {
  vi.resetAllMocks();
});

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
    mockInstructionFiles(mockFs, { 'AGENTS.md': content });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-exists')!.check;
    expect(check.status).toBe('pass');
    expect(check.score).toBe(100);
  });

  it('detects build commands in AGENTS.md', () => {
    mockInstructionFiles(mockFs, { 'AGENTS.md': '## Build\nnpm run build\n' });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-build')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects test commands in AGENTS.md', () => {
    mockInstructionFiles(mockFs, { 'AGENTS.md': '## Testing\nnpm test\n' });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-test')!.check;
    expect(check.status).toBe('pass');
  });

  it('detects architecture section in AGENTS.md', () => {
    mockInstructionFiles(mockFs, { 'AGENTS.md': '## Architecture\nThree-process Electron architecture\n' });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-architecture')!.check;
    expect(check.status).toBe('pass');
  });

  it('warns for small AGENTS.md', () => {
    const content = linesOf(30);
    mockInstructionFiles(mockFs, { 'AGENTS.md': content });

    const tagged = codexInstructionsProducer.produce('/test/project', ctx);
    const check = tagged.find(t => t.check.id === 'agents-md-size')!.check;
    expect(check.status).toBe('warning');
    expect(check.score).toBe(50);
  });

  it('passes for good size AGENTS.md', () => {
    const content = linesOf(100);
    mockInstructionFiles(mockFs, { 'AGENTS.md': content });

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

describe('codexInstructionsProducer nested AGENTS.md', () => {
  const NESTED = 'packages/api/AGENTS.md';
  // git ls-files emits forward slashes on every platform; readFileSafe joins with the
  // platform separator, so the mock key has to be built the same way the impl builds it.
  const NESTED_KEY = path.join('packages', 'api', 'AGENTS.md');

  // The colon distinguishes a nested row (`agents-md-size:<path>`) from the single root
  // `agents-md-size` row, which is always emitted — it reports "missing" too.
  function nestedChecks(trackedFiles: string[]) {
    return codexInstructionsProducer
      .produce('/test/project', makeAnalysisContext(trackedFiles))
      .map(t => t.check)
      .filter(c => c.id.startsWith('agents-md-size:'));
  }

  function allSizeChecks(trackedFiles: string[]) {
    return codexInstructionsProducer
      .produce('/test/project', makeAnalysisContext(trackedFiles))
      .map(t => t.check)
      .filter(c => c.id.startsWith('agents-md-size'));
  }

  it('fails an oversized nested AGENTS.md and names its real path everywhere', () => {
    // Nested key first: `endsWith('AGENTS.md')` would otherwise swallow the nested path.
    mockInstructionFiles(mockFs, { [NESTED_KEY]: linesOf(700) });

    const nested = nestedChecks([NESTED])[0];

    expect(nested.id).toBe(`agents-md-size:${NESTED}`);
    expect(nested.status).toBe('fail');
    expect(nested.name).toBe(`${NESTED} size`);
    expect(nested.description).toBe(`${NESTED} is 700 lines — too long, may waste context window.`);
    // The whole point of the fix: the prompt must name the nested file, not the root one.
    expect(nested.fixPrompt).toContain(`The ${NESTED} file is too long`);
  });

  it('warns for a nested AGENTS.md between the warn and fail thresholds', () => {
    mockInstructionFiles(mockFs, { [NESTED_KEY]: linesOf(400) });

    const nested = nestedChecks([NESTED])[0];

    expect(nested.status).toBe('warning');
    expect(nested.description).toBe(`${NESTED} is 400 lines — consider trimming for focus.`);
  });

  it('emits no row for a nested AGENTS.md within limits', () => {
    mockInstructionFiles(mockFs, { [NESTED_KEY]: linesOf(120) });

    expect(nestedChecks([NESTED])).toHaveLength(0);
  });

  it('reports root and nested files independently', () => {
    mockInstructionFiles(mockFs, {
      [NESTED_KEY]: linesOf(700),
      'AGENTS.md': linesOf(400),
    });

    const checks = allSizeChecks(['AGENTS.md', NESTED]);

    expect(checks).toHaveLength(2);
    const root = checks.find(c => c.id === 'agents-md-size')!;
    expect(root.description).toBe('AGENTS.md is 400 lines — consider trimming for focus.');
    expect(checks.find(c => c.id === `agents-md-size:${NESTED}`)!.description)
      .toBe(`${NESTED} is 700 lines — too long, may waste context window.`);
  });

  it('ignores tracked files that merely end in the instruction file name', () => {
    mockInstructionFiles(mockFs, { 'MY-AGENTS.md': linesOf(700) });

    expect(nestedChecks(['docs/MY-AGENTS.md'])).toHaveLength(0);
  });

  it('behaves exactly as before when there are no tracked files', () => {
    mockInstructionFiles(mockFs, { 'AGENTS.md': linesOf(700) });

    const checks = allSizeChecks([]);

    expect(checks).toHaveLength(1);
    expect(checks[0].id).toBe('agents-md-size');
  });

  it('marks nested rows informational so a monorepo cannot collapse the category score', () => {
    mockInstructionFiles(mockFs, { [NESTED_KEY]: linesOf(700) });

    const [nested] = nestedChecks([NESTED]);

    // computeCategoryScore skips informational checks, so N of these cannot outvote the
    // five scored root checks no matter how many packages a repo has.
    expect(nested.informational).toBe(true);
    expect(nested.maxScore).toBe(0);
  });

  it('honors .vibeyardignore', () => {
    mockInstructionFiles(mockFs, {
      '.vibeyardignore': 'vendor/**\n',
      [path.join('vendor', 'thing', 'AGENTS.md')]: linesOf(700),
    });

    expect(nestedChecks(['vendor/thing/AGENTS.md'])).toHaveLength(0);
  });

  it('keeps the worst offenders when more than MAX_NESTED_ROWS files are oversized', () => {
    const files: Record<string, string> = {};
    const tracked: string[] = [];
    // Alphabetically ascending paths, deliberately ordered smallest-file-first so a naive
    // "first 20 wins" cap would drop every one of the genuinely worst files.
    for (let i = 0; i < 25; i++) {
      const dir = `p${String(i).padStart(2, '0')}`;
      files[path.join('packages', dir, 'AGENTS.md')] = linesOf(400 + i * 10);
      tracked.push(`packages/${dir}/AGENTS.md`);
    }
    mockInstructionFiles(mockFs, files);

    const nested = nestedChecks(tracked);

    expect(nested).toHaveLength(20);
    expect(nested[0].id).toBe('agents-md-size:packages/p24/AGENTS.md');
    expect(nested.some(c => c.id === 'agents-md-size:packages/p00/AGENTS.md')).toBe(false);
  });
});
