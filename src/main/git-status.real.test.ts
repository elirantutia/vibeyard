import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getGitFiles, getGitDiff } from './git-status';

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

// Real temporary-repository tests. These intentionally do NOT mock
// child_process or fs so that Git's own -z porcelain output (raw, unquoted
// path bytes) is exercised end to end, including non-ASCII filenames that
// Git C-quotes in non -z mode.
describe('getGitFiles (real repository)', () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'git-status-real-'));
    await git(repoDir, ['init', '-q']);
    await git(repoDir, ['config', 'core.quotePath', 'true']);
    await git(repoDir, ['config', 'user.email', 'test@example.com']);
    await git(repoDir, ['config', 'user.name', 'Test']);
  });

  afterEach(async () => {
    await fs.promises.rm(repoDir, { recursive: true, force: true });
  });

  it('decodes a non-ASCII untracked filename and reads its diff', async () => {
    fs.writeFileSync(path.join(repoDir, 'café.txt'), 'cafe content\n');
    const files = await getGitFiles(repoDir);
    expect(files).toContainEqual({ path: 'café.txt', status: 'untracked', area: 'untracked' });
    const diff = await getGitDiff(repoDir, 'café.txt', 'untracked');
    expect(diff).toContain('cafe content');
    expect(diff).not.toContain('(unable to read file)');
  });

  it('round-trips a staged rename from status to diff', async () => {
    fs.writeFileSync(path.join(repoDir, 'a b.txt'), 'hello\n');
    await git(repoDir, ['add', 'a b.txt']);
    await git(repoDir, ['commit', '-qm', 'init']);
    await git(repoDir, ['mv', 'a b.txt', 'c d.txt']);
    const files = await getGitFiles(repoDir);
    expect(files).toContainEqual({ path: 'c d.txt', status: 'renamed', area: 'staged' });
    const diff = await getGitDiff(repoDir, 'c d.txt', 'staged');
    expect(diff).toContain('c d.txt');
    expect(diff).not.toContain('(no diff available)');
  });
});
