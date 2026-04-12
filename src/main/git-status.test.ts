import { vi } from 'vitest';
import type { ExecFileException } from 'child_process';

// Mock child_process and fs before importing the module
vi.mock('child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

import * as path from 'path';
import { execFile } from 'child_process';
import { readFileSync } from 'fs';
import * as store from './store';
import {
  getGitStatus,
  getGitFiles,
  getGitDiff,
  getGitWorktrees,
  isPathWithinKnownLinkedWorktree,
  clearWorktreeRootsCache,
  resolveWorktreeDestination,
  createGitWorktree,
} from './git-status';

const mockExecFile = vi.mocked(execFile);
const mockReadFileSync = vi.mocked(readFileSync);

function simulateExecFile(err: ExecFileException | null, stdout: string) {
  mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
    (callback as (err: ExecFileException | null, stdout: string) => void)(err, stdout);
    return undefined as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearWorktreeRootsCache();
});

describe('getGitStatus', () => {
  it('parses branch name', async () => {
    simulateExecFile(null, '# branch.head main\n');
    const status = await getGitStatus('/test');
    expect(status.isGitRepo).toBe(true);
    expect(status.branch).toBe('main');
  });

  it('parses ahead/behind', async () => {
    simulateExecFile(null, '# branch.head main\n# branch.ab +3 -1\n');
    const status = await getGitStatus('/test');
    expect(status.ahead).toBe(3);
    expect(status.behind).toBe(1);
  });

  it('counts staged changes (X != .)', async () => {
    simulateExecFile(null, '1 M. N... 100644 100644 100644 abc def file.ts\n');
    const status = await getGitStatus('/test');
    expect(status.staged).toBe(1);
    expect(status.modified).toBe(0);
  });

  it('counts working tree changes (Y != .)', async () => {
    simulateExecFile(null, '1 .M N... 100644 100644 100644 abc def file.ts\n');
    const status = await getGitStatus('/test');
    expect(status.staged).toBe(0);
    expect(status.modified).toBe(1);
  });

  it('counts both staged and modified', async () => {
    simulateExecFile(null, '1 MM N... 100644 100644 100644 abc def file.ts\n');
    const status = await getGitStatus('/test');
    expect(status.staged).toBe(1);
    expect(status.modified).toBe(1);
  });

  it('counts rename entries (type 2)', async () => {
    simulateExecFile(null, '2 R. N... 100644 100644 100644 abc def R100\told.ts\tnew.ts\n');
    const status = await getGitStatus('/test');
    expect(status.staged).toBe(1);
  });

  it('counts unmerged entries', async () => {
    simulateExecFile(null, 'u UU N... 100644 100644 100644 100644 abc def ghi file.ts\n');
    const status = await getGitStatus('/test');
    expect(status.conflicted).toBe(1);
  });

  it('counts untracked files', async () => {
    simulateExecFile(null, '? new-file.ts\n? another.ts\n');
    const status = await getGitStatus('/test');
    expect(status.untracked).toBe(2);
  });

  it('returns NOT_A_REPO on error', async () => {
    simulateExecFile(new Error('not a git repo') as ExecFileException, '');
    const status = await getGitStatus('/test');
    expect(status.isGitRepo).toBe(false);
    expect(status.branch).toBeNull();
  });

  it('handles complex output with all entry types', async () => {
    const output = [
      '# branch.head feature/test',
      '# branch.ab +2 -0',
      '1 M. N... 100644 100644 100644 abc def staged.ts',
      '1 .M N... 100644 100644 100644 abc def modified.ts',
      '2 R. N... 100644 100644 100644 abc def R100\told.ts\tnew.ts',
      'u UU N... 100644 100644 100644 100644 abc def ghi conflict.ts',
      '? untracked.ts',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const status = await getGitStatus('/test');

    expect(status.branch).toBe('feature/test');
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(0);
    expect(status.staged).toBe(2); // M. + R.
    expect(status.modified).toBe(1); // .M
    expect(status.conflicted).toBe(1);
    expect(status.untracked).toBe(1);
  });
});

describe('getGitFiles', () => {
  it('returns file entries with correct status and area', async () => {
    simulateExecFile(null, '1 A. N... 100644 100644 100644 abc def added.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'added.ts', status: 'added', area: 'staged' }]);
  });

  it('creates entries for both staged and working changes', async () => {
    simulateExecFile(null, '1 MM N... 100644 100644 100644 abc def both.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toHaveLength(2);
    expect(files[0]).toEqual({ path: 'both.ts', status: 'modified', area: 'staged' });
    expect(files[1]).toEqual({ path: 'both.ts', status: 'modified', area: 'working' });
  });

  it('handles rename entries with tab-delimited paths', async () => {
    simulateExecFile(null, '2 R. N... 100644 100644 100644 abc def R100\told.ts\tnew.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'new.ts', status: 'renamed', area: 'staged' }]);
  });

  it('handles deleted files', async () => {
    simulateExecFile(null, '1 D. N... 100644 100644 100644 abc def removed.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'removed.ts', status: 'deleted', area: 'staged' }]);
  });

  it('handles unmerged files', async () => {
    simulateExecFile(null, 'u UU N... 100644 100644 100644 100644 abc def ghi\tconflict.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'conflict.ts', status: 'conflicted', area: 'conflicted' }]);
  });

  it('handles untracked files', async () => {
    simulateExecFile(null, '? new-file.ts\n');
    const files = await getGitFiles('/test');
    expect(files).toEqual([{ path: 'new-file.ts', status: 'untracked', area: 'untracked' }]);
  });

  it('returns empty array on error', async () => {
    simulateExecFile(new Error('not a git repo') as ExecFileException, '');
    const files = await getGitFiles('/test');
    expect(files).toEqual([]);
  });
});

describe('getGitDiff', () => {
  it('returns formatted diff for untracked files', async () => {
    mockReadFileSync.mockReturnValueOnce('line1\nline2\n');
    const diff = await getGitDiff('/test', 'new.ts', 'untracked');
    expect(diff).toContain('--- /dev/null');
    expect(diff).toContain('+++ b/new.ts');
    expect(diff).toContain('+line1');
    expect(diff).toContain('+line2');
  });

  it('returns error message when untracked file cannot be read', async () => {
    mockReadFileSync.mockImplementationOnce(() => { throw new Error('ENOENT'); });
    const diff = await getGitDiff('/test', 'missing.ts', 'untracked');
    expect(diff).toBe('(unable to read file)');
  });

  it('calls git diff --cached for staged files', async () => {
    simulateExecFile(null, 'diff --cached output');
    await getGitDiff('/test', 'file.ts', 'staged');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--cached', '--', 'file.ts'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('calls git diff for working tree files', async () => {
    simulateExecFile(null, 'diff output');
    await getGitDiff('/test', 'file.ts', 'working');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--', 'file.ts'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('returns "(no diff available)" on error with no stdout', async () => {
    mockExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
      (callback as (err: ExecFileException | null, stdout: string) => void)(
        new Error('err') as ExecFileException,
        '',
      );
      return undefined as never;
    });
    const diff = await getGitDiff('/test', 'file.ts', 'working');
    expect(diff).toBe('(no diff available)');
  });
});

describe('getGitWorktrees', () => {
  it('parses porcelain output with main and linked worktree', async () => {
    const output = [
      'worktree /repo',
      'HEAD abc1234567890abcdef1234567890abcdef123456',
      'branch refs/heads/main',
      '',
      'worktree /repo-feature',
      'HEAD def4567890abcdef1234567890abcdef1234567890',
      'branch refs/heads/feature-branch',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const worktrees = await getGitWorktrees('/repo');

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toEqual({
      path: '/repo',
      head: 'abc1234567890abcdef1234567890abcdef123456',
      branch: 'main',
      isBare: false,
    });
    expect(worktrees[1]).toEqual({
      path: '/repo-feature',
      head: 'def4567890abcdef1234567890abcdef1234567890',
      branch: 'feature-branch',
      isBare: false,
    });
  });

  it('handles detached HEAD worktree', async () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /repo-detached',
      'HEAD def456',
      'detached',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const worktrees = await getGitWorktrees('/repo');

    expect(worktrees).toHaveLength(2);
    expect(worktrees[1]).toEqual({
      path: '/repo-detached',
      head: 'def456',
      branch: null,
      isBare: false,
    });
  });

  it('handles bare worktree', async () => {
    const output = [
      'worktree /repo.git',
      'HEAD abc123',
      'bare',
      '',
      'worktree /repo-wt',
      'HEAD def456',
      'branch refs/heads/main',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const worktrees = await getGitWorktrees('/repo.git');

    expect(worktrees).toHaveLength(2);
    expect(worktrees[0].isBare).toBe(true);
    expect(worktrees[0].branch).toBeNull();
    expect(worktrees[1].isBare).toBe(false);
    expect(worktrees[1].branch).toBe('main');
  });

  it('returns empty array on error', async () => {
    simulateExecFile(new Error('not a git repo') as ExecFileException, '');
    const worktrees = await getGitWorktrees('/test');
    expect(worktrees).toEqual([]);
  });

  it('handles single worktree (no linked)', async () => {
    const output = [
      'worktree /repo',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
    ].join('\n');

    simulateExecFile(null, output);
    const worktrees = await getGitWorktrees('/repo');

    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].path).toBe('/repo');
  });
});

describe('linked worktree path helpers', () => {
  const mockState = {
    version: 1 as const,
    activeProjectId: null,
    projects: [
      {
        id: 'p1',
        name: 'Repo',
        path: '/repo',
        sessions: [] as never[],
        activeSessionId: null,
        layout: { mode: 'tabs' as const, splitPanes: [], splitDirection: 'horizontal' as const },
      },
    ],
    preferences: {
      soundOnSessionWaiting: true,
      notificationsDesktop: true,
      debugMode: false,
      sessionHistoryEnabled: true,
      insightsEnabled: true,
      autoTitleEnabled: true,
    },
  };

  it('treats paths under a linked worktree as in-scope when worktrees are cached', async () => {
    vi.spyOn(store, 'loadState').mockReturnValue(mockState);
    const output = [
      'worktree /repo',
      'HEAD abcdef1234567890abcdef1234567890abcdef12',
      'branch refs/heads/main',
      '',
      'worktree /repo-wt',
      'HEAD abcdef1234567890abcdef1234567890abcdef12',
      'branch refs/heads/feature',
    ].join('\n');
    simulateExecFile(null, output);
    await getGitWorktrees('/repo');
    expect(isPathWithinKnownLinkedWorktree(path.resolve('/repo-wt/foo.ts'))).toBe(true);
    expect(isPathWithinKnownLinkedWorktree(path.resolve('/other/outside'))).toBe(false);
  });

  it('drops cached roots when worktree list fails', async () => {
    vi.spyOn(store, 'loadState').mockReturnValue(mockState);
    const ok = [
      'worktree /repo',
      'HEAD abc',
      '',
      'worktree /repo-wt',
      'HEAD abc',
      'branch refs/heads/feature',
    ].join('\n');
    simulateExecFile(null, ok);
    await getGitWorktrees('/repo');
    simulateExecFile(new Error('git failed') as ExecFileException, '');
    await getGitWorktrees('/repo');
    expect(isPathWithinKnownLinkedWorktree(path.resolve('/repo-wt/x'))).toBe(false);
  });
});

describe('resolveWorktreeDestination', () => {
  it('joins a relative path to the parent of the repo root', () => {
    expect(resolveWorktreeDestination('/home/u/code/src/fridge-inventory-app', 'fridge-wt')).toBe(
      path.normalize('/home/u/code/src/fridge-wt'),
    );
  });

  it('does not nest under the repo directory', () => {
    expect(resolveWorktreeDestination('/repo/my-app', 'wt')).toBe(path.normalize('/repo/wt'));
  });

  it('leaves absolute paths unchanged (only normalizes)', () => {
    expect(resolveWorktreeDestination('/repo/my-app', '/tmp/explicit-wt')).toBe('/tmp/explicit-wt');
  });
});

describe('createGitWorktree', () => {
  const noWslPrefs = {
    version: 1 as const,
    activeProjectId: null,
    projects: [],
    preferences: {
      soundOnSessionWaiting: true,
      notificationsDesktop: true,
      debugMode: false,
      sessionHistoryEnabled: true,
      insightsEnabled: true,
      autoTitleEnabled: true,
    },
  };

  it('passes repo-parent-relative path to git worktree add', async () => {
    vi.spyOn(store, 'loadState').mockReturnValue(noWslPrefs as never);
    simulateExecFile(null, '');
    await createGitWorktree('/home/u/code/src/my-app', 'parallel-wt');
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain(path.normalize('/home/u/code/src/parallel-wt'));
    expect(args.join(' ')).toContain('worktree add');
  });

  it('passes absolute worktree path through to git', async () => {
    vi.spyOn(store, 'loadState').mockReturnValue(noWslPrefs as never);
    simulateExecFile(null, '');
    const abs = path.normalize('/var/worktrees/foo');
    await createGitWorktree('/home/u/code/src/my-app', abs);
    const args = mockExecFile.mock.calls[0][1] as string[];
    expect(args).toContain(abs);
  });
});
