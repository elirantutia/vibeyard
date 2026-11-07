import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { knownProjectRoots, isWithinRoots } from './project-roots';

describe('knownProjectRoots', () => {
  it('includes local project paths and local ad-hoc session folders', () => {
    const roots = knownProjectRoots([
      { path: '/repo/app', sessions: [{ runPath: '/tmp/scratch' }] },
    ]);
    expect(roots).toEqual([path.resolve('/repo/app'), path.resolve('/tmp/scratch')]);
  });

  it('never trusts the empty path of the folder-less Temporary project', () => {
    expect(knownProjectRoots([{ path: '', sessions: [] }])).toEqual([]);
  });

  it('skips paths that live on an SSH host', () => {
    const roots = knownProjectRoots([
      { path: '/srv/app', remoteHost: 'box' },
      { path: '', sessions: [{ runPath: '/home/u/x', sshHost: 'box' }] },
    ]);
    expect(roots).toEqual([]);
  });
});

describe('isWithinRoots', () => {
  const roots = [path.resolve('/repo/app')];

  it('accepts the root itself and paths inside it', () => {
    expect(isWithinRoots(path.resolve('/repo/app'), roots)).toBe(true);
    expect(isWithinRoots(path.join(path.resolve('/repo/app'), 'src', 'x.ts'), roots)).toBe(true);
  });

  it('rejects siblings sharing a prefix and unrelated paths', () => {
    expect(isWithinRoots(path.resolve('/repo/app-other/x'), roots)).toBe(false);
    expect(isWithinRoots(path.resolve('/etc/passwd'), roots)).toBe(false);
  });

  it('rejects everything when there are no roots (Temporary project only)', () => {
    expect(isWithinRoots(path.resolve('/etc/passwd'), knownProjectRoots([{ path: '' }]))).toBe(false);
  });
});
