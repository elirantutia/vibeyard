import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { GitWorktree, GitFileEntry } from '../shared/types';

export type { GitWorktree, GitFileEntry } from '../shared/types';

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
    execFile(
      'git',
      ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
      { cwd, timeout: 5000 },
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
  if (area === 'untracked') return readUntrackedDiff(path.join(cwd, filePath), filePath);
  return new Promise((resolve) => {

    const args = area === 'staged'
      ? ['diff', '--cached', '--', filePath]
      : ['diff', '--', filePath];

    execFile(
      'git',
      args,
      { cwd, timeout: 10000, maxBuffer: 1024 * 1024 },
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

/** Porcelain-v2 metadata has a fixed field count; filenames may contain spaces. */
function pathAfterFields(line: string, fieldCount: number): string | null {
  let cursor = 0;
  for (let i = 0; i < fieldCount; i++) {
    cursor = line.indexOf(' ', cursor);
    if (cursor < 0) return null;
    cursor++;
  }
  return line.slice(cursor) || null;
}

export function getGitFiles(cwd: string): Promise<GitFileEntry[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['status', '--porcelain=v2', '-z', '--untracked-files=all'],
      { cwd, timeout: 5000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }

        const entries: GitFileEntry[] = [];
        // -z output is NUL-terminated; paths are raw bytes, never C-quoted.
        // A rename record is followed by a separate NUL chunk holding the
        // original path, which is informational and not part of GitFileEntry.
        const records = stdout.split('\0');

        for (let i = 0; i < records.length; i++) {
          const record = records[i];
          if (record.startsWith('1 ') || record.startsWith('2 ')) {
            const xy = record.slice(2, 4);
            // Type 2 (rename) has 9 fields before the current path; type 1 has 8.
            const path = pathAfterFields(record, record.startsWith('2 ') ? 9 : 8);
            if (record.startsWith('2 ')) {
              i++; // skip the original-path chunk
            }
            if (path && xy.length >= 2) {
              const x = xy[0]; // staged
              const y = xy[1]; // working tree
              if (x !== '.') {
                entries.push({ path, status: xyToStatus(x), area: 'staged' });
              }
              if (y !== '.') {
                entries.push({ path, status: xyToStatus(y), area: 'working' });
              }
            }
          } else if (record.startsWith('u ')) {
            // Unmerged entry
            const path = pathAfterFields(record, 10);
            if (path) entries.push({ path, status: 'conflicted', area: 'conflicted' });
          } else if (record.startsWith('? ')) {
            const path = record.slice(2);
            if (path) entries.push({ path, status: 'untracked', area: 'untracked' });
          }
        }

        resolve(entries);
      }
    );
  });
}

function execGit(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 5000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function execGitWithOutput(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
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
    const fullPath = path.join(cwd, filePath);
    return fs.promises.rm(fullPath, { recursive: true, force: true });
  }
  return execGit(cwd, ['checkout', '--', filePath]);
}

export function getGitWorktrees(cwd: string): Promise<GitWorktree[]> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd, timeout: 5000 },
      (err, stdout) => {
        if (err) {
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

        resolve(worktrees);
      }
    );
  });
}

export function getGitRemoteUrl(cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['remote', 'get-url', 'origin'], { cwd }, (err, stdout) => {
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

// Bound both disk input and expanded diff output, even if a file grows during the read.
async function readUntrackedDiff(fullPath: string, filePath: string): Promise<string> {
  const limit = 256 * 1024;
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(fullPath, 'r');
    if ((await handle.stat()).size > limit) return '(file too large to preview; limit 256 KiB)';
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) return '(file too large to preview; limit 256 KiB)';
    if (buffer.subarray(0, length).includes(0)) return '(binary file; no text preview)';
    const lines = buffer.toString('utf8', 0, length).split('\n');
    if (lines.length > 5000) return '(too many lines to preview; limit 5,000 lines)';
    return '--- /dev/null\n+++ b/' + filePath + '\n@@ -0,0 +1,' + lines.length + ' @@\n' + lines.map(line => '+' + line).join('\n');
  } catch { return '(unable to read file)'; }
  finally { await handle?.close().catch(() => {}); }
}
