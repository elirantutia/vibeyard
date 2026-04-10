import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GitWorktree, GitFileEntry } from '../shared/types';
import { isWslMode } from './platform';
import { loadState } from './store';
import { joinStoredProjectPath, pathIsWithinStoredProject } from './project-fs-path';

/**
 * Resolve the git binary and cwd for execution.
 * In WSL mode, routes through `wsl.exe -d <distro> -- git`.
 */
export function resolveGitCommand(cwd: string): { bin: string; prefixArgs: string[]; execCwd: string } {
  const state = loadState();
  if (isWslMode(state.preferences)) {
    const { getEffectiveDistro, winPathToWsl, uncWslPathToLinuxPath } = require('./wsl') as typeof import('./wsl');
    const distro = getEffectiveDistro(state.preferences.wslDistro) || 'Ubuntu';
    const fromUnc = uncWslPathToLinuxPath(cwd);
    const linuxCwd = fromUnc
      ? fromUnc
      : cwd.includes('\\') || /^[A-Za-z]:/.test(cwd)
        ? winPathToWsl(cwd, distro)
        : cwd;
    return {
      bin: 'wsl.exe',
      prefixArgs: ['-d', distro, '--', 'git', '-C', linuxCwd],
      execCwd: os.tmpdir(),
    };
  }
  return { bin: 'git', prefixArgs: [], execCwd: cwd };
}

/** Tracked file paths from `git ls-files` (works with POSIX project roots in WSL mode). */
export function getGitTrackedFiles(projectPath: string): string[] {
  const g = resolveGitCommand(projectPath);
  try {
    const out = execFileSync(g.bin, [...g.prefixArgs, 'ls-files'], {
      cwd: g.execCwd,
      encoding: 'utf-8',
      timeout: 5000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

export type { GitWorktree, GitFileEntry } from '../shared/types';

/** Queried project path → non-bare worktree roots (for fs access + watchers). */
const worktreeRootsByProject = new Map<string, string[]>();

function worktreeCacheKey(projectPath: string): string {
  return projectPath.replace(/\\/g, '/');
}

export function clearWorktreeRootsCache(): void {
  worktreeRootsByProject.clear();
}

function recordWorktreeRoots(projectPath: string, worktrees: GitWorktree[]): void {
  const roots = worktrees.filter((w) => !w.isBare).map((w) => w.path.replace(/\\/g, '/'));
  worktreeRootsByProject.set(worktreeCacheKey(projectPath), roots);
}

/**
 * True when the path lies under a linked worktree of a known project (sibling dirs, etc.).
 * Populated when `getGitWorktrees` runs for that project's stored root path.
 */
export function isPathWithinKnownLinkedWorktree(resolvedAbsolute: string): boolean {
  const state = loadState();
  for (const p of state.projects) {
    const roots = worktreeRootsByProject.get(worktreeCacheKey(p.path));
    if (!roots) continue;
    for (const root of roots) {
      if (pathIsWithinStoredProject(resolvedAbsolute, root)) return true;
    }
  }
  return false;
}

export interface GitStatus {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

const NOT_A_REPO: GitStatus = {
  isGitRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  staged: 0,
  modified: 0,
  untracked: 0,
  conflicted: 0,
};

export function getGitStatus(cwd: string): Promise<GitStatus> {
  return new Promise((resolve) => {
    const g = resolveGitCommand(cwd);
    execFile(
      g.bin,
      [...g.prefixArgs, 'status', '--porcelain=v2', '--branch'],
      { cwd: g.execCwd, timeout: 5000 },
      (err, stdout) => {
        if (err) {
          resolve(NOT_A_REPO);
          return;
        }

        let branch: string | null = null;
        let ahead = 0;
        let behind = 0;
        let staged = 0;
        let modified = 0;
        let untracked = 0;
        let conflicted = 0;

        for (const line of stdout.split('\n')) {
          if (line.startsWith('# branch.head ')) {
            branch = line.slice('# branch.head '.length);
          } else if (line.startsWith('# branch.ab ')) {
            const match = line.match(/\+(\d+) -(\d+)/);
            if (match) {
              ahead = parseInt(match[1], 10);
              behind = parseInt(match[2], 10);
            }
          } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
            // Ordinary/rename entries: XY field is at index 2 (after the type char and space)
            const xy = line.split(' ')[1];
            if (xy && xy.length >= 2) {
              const x = xy[0]; // staged
              const y = xy[1]; // working tree
              if (x !== '.') staged++;
              if (y !== '.') modified++;
            }
          } else if (line.startsWith('u ')) {
            conflicted++;
          } else if (line.startsWith('? ')) {
            untracked++;
          }
        }

        resolve({
          isGitRepo: true,
          branch,
          ahead,
          behind,
          staged,
          modified,
          untracked,
          conflicted,
        });
      }
    );
  });
}

export function getGitDiff(cwd: string, filePath: string, area: string): Promise<string> {
  return new Promise((resolve) => {
    if (area === 'untracked') {
      const fullPath = joinStoredProjectPath(cwd, filePath);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const header = `--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`;
        const body = lines.map(l => `+${l}`).join('\n');
        resolve(header + body);
      } catch {
        resolve('(unable to read file)');
      }
      return;
    }

    const diffArgs = area === 'staged'
      ? ['diff', '--cached', '--', filePath]
      : ['diff', '--', filePath];

    const g = resolveGitCommand(cwd);
    execFile(
      g.bin,
      [...g.prefixArgs, ...diffArgs],
      { cwd: g.execCwd, timeout: 10000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err && !stdout) {
          resolve('(no diff available)');
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function xyToStatus(ch: string): 'added' | 'modified' | 'deleted' | 'renamed' {
  switch (ch) {
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    default: return 'modified';
  }
}

export function getGitFiles(cwd: string): Promise<GitFileEntry[]> {
  return new Promise((resolve) => {
    const g = resolveGitCommand(cwd);
    execFile(
      g.bin,
      [...g.prefixArgs, 'status', '--porcelain=v2'],
      { cwd: g.execCwd, timeout: 5000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }

        const entries: GitFileEntry[] = [];

        for (const line of stdout.split('\n')) {
          if (line.startsWith('1 ') || line.startsWith('2 ')) {
            // Ordinary (1) or rename (2) entry
            const parts = line.split('\t');
            const fields = parts[0].split(' ');
            const xy = fields[1];
            // For type 1: path is last space-delimited field
            // For type 2: path is the second tab-delimited field (new name)
            const path = line.startsWith('2 ') && parts.length >= 2
              ? parts[parts.length - 1]
              : fields[fields.length - 1];

            if (xy && xy.length >= 2) {
              const x = xy[0]; // staged
              const y = xy[1]; // working tree
              if (x !== '.') {
                entries.push({ path, status: xyToStatus(x), area: 'staged' });
              }
              if (y !== '.') {
                entries.push({ path, status: xyToStatus(y), area: 'working' });
              }
            }
          } else if (line.startsWith('u ')) {
            // Unmerged entry
            const parts = line.split('\t');
            const path = parts.length >= 2 ? parts[parts.length - 1] : line.split(' ').pop()!;
            entries.push({ path, status: 'conflicted', area: 'conflicted' });
          } else if (line.startsWith('? ')) {
            const path = line.slice(2);
            entries.push({ path, status: 'untracked', area: 'untracked' });
          }
        }

        resolve(entries);
      }
    );
  });
}

function execGit(cwd: string, args: string[]): Promise<void> {
  const g = resolveGitCommand(cwd);
  return new Promise((resolve, reject) => {
    execFile(g.bin, [...g.prefixArgs, ...args], { cwd: g.execCwd, timeout: 5000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function execGitWithOutput(cwd: string, args: string[]): Promise<string> {
  const g = resolveGitCommand(cwd);
  return new Promise((resolve, reject) => {
    execFile(g.bin, [...g.prefixArgs, ...args], { cwd: g.execCwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

export interface GitBranch {
  name: string;
  current: boolean;
}

export async function listGitBranches(cwd: string): Promise<GitBranch[]> {
  const stdout = await execGitWithOutput(cwd, ['branch', '--list']);
  const branches: GitBranch[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const current = trimmed.startsWith('* ');
    const name = trimmed.slice(2);
    // Skip detached HEAD entries like "(HEAD detached at ...)"
    if (name.startsWith('(')) continue;
    branches.push({ name, current });
  }
  return branches;
}

export async function checkoutGitBranch(cwd: string, branch: string): Promise<void> {
  await execGit(cwd, ['checkout', branch]);
}

export async function createGitBranch(cwd: string, branch: string): Promise<void> {
  await execGit(cwd, ['checkout', '-b', branch]);
}

export function gitStageFile(cwd: string, filePath: string): Promise<void> {
  return execGit(cwd, ['add', '--', filePath]);
}

export function gitUnstageFile(cwd: string, filePath: string): Promise<void> {
  return execGit(cwd, ['reset', 'HEAD', '--', filePath]);
}

export function gitDiscardFile(cwd: string, filePath: string, area: GitFileEntry['area']): Promise<void> {
  if (area === 'untracked') {
    const fullPath = joinStoredProjectPath(cwd, filePath);
    return fs.promises.unlink(fullPath);
  }
  return execGit(cwd, ['checkout', '--', filePath]);
}

export function getGitWorktrees(cwd: string): Promise<GitWorktree[]> {
  return new Promise((resolve) => {
    const g = resolveGitCommand(cwd);
    execFile(
      g.bin,
      [...g.prefixArgs, 'worktree', 'list', '--porcelain'],
      { cwd: g.execCwd, timeout: 5000 },
      (err, stdout) => {
        const key = worktreeCacheKey(cwd);
        if (err) {
          worktreeRootsByProject.delete(key);
          resolve([]);
          return;
        }

        const worktrees: GitWorktree[] = [];
        const blocks = stdout.split('\n\n');

        for (const block of blocks) {
          const lines = block.trim().split('\n');
          if (lines.length === 0 || !lines[0]) continue;

          let path = '';
          let head = '';
          let branch: string | null = null;
          let isBare = false;

          for (const line of lines) {
            if (line.startsWith('worktree ')) {
              path = line.slice('worktree '.length);
            } else if (line.startsWith('HEAD ')) {
              head = line.slice('HEAD '.length);
            } else if (line.startsWith('branch ')) {
              const ref = line.slice('branch '.length);
              branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
            } else if (line === 'bare') {
              isBare = true;
            } else if (line === 'detached') {
              branch = null;
            }
          }

          if (path) {
            worktrees.push({ path, head, branch, isBare });
          }
        }

        recordWorktreeRoots(cwd, worktrees);
        resolve(worktrees);
      }
    );
  });
}

export function getGitRemoteUrl(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const g = resolveGitCommand(cwd);
    execFile(g.bin, [...g.prefixArgs, 'remote', 'get-url', 'origin'], { cwd: g.execCwd }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const raw = stdout.trim();
      // Normalize SSH (git@github.com:owner/repo.git) to HTTPS
      const ssh = raw.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
      if (ssh) { resolve(`https://${ssh[1]}/${ssh[2]}`); return; }
      // Strip trailing .git from HTTPS URLs
      resolve(raw.replace(/\.git$/, '') || null);
    });
  });
}
