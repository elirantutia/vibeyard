import * as path from 'path';
import { localProjectFolder } from '../shared/project-folder';

interface RootSource {
  path: string;
  remoteHost?: string;
  temporary?: boolean;
  sessions?: Array<{ runPath?: string; sshHost?: string }>;
}

/**
 * Local directories the main-process fs sandbox trusts: each local project's
 * path, plus the own folder of every local ad-hoc session (the Temporary
 * project's sessions). Empty paths (the folder-less Temporary project) are
 * skipped — `'' + sep` is the filesystem root on POSIX and would admit every
 * path — and so are paths that live on an SSH host (remote projects and
 * remote sessions name directories that are not on this machine).
 */
export function knownProjectRoots(projects: RootSource[]): string[] {
  const roots: string[] = [];
  for (const p of projects) {
    const folder = localProjectFolder(p);
    if (folder) roots.push(path.resolve(folder));
    for (const s of p.sessions ?? []) {
      if (s.runPath && !s.sshHost) roots.push(path.resolve(s.runPath));
    }
  }
  return roots;
}

/** Whether `resolvedPath` is one of `roots` or inside one. */
export function isWithinRoots(resolvedPath: string, roots: string[]): boolean {
  return roots.some((root) => resolvedPath === root || resolvedPath.startsWith(root.endsWith(path.sep) ? root : root + path.sep));
}
