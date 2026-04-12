import type { SessionRecord } from '../shared/types.js';

/**
 * Directory passed to `pty.create` for CLI sessions: linked worktree when set, else project root.
 * Non-CLI session kinds keep `projectPath` (they do not use this for spawning in split-layout).
 */
export function resolveCliSessionPtyCwd(
  projectPath: string,
  session: Pick<SessionRecord, 'type' | 'gitWorktreePath'>,
): string {
  if (session.type) return projectPath;
  const wt = session.gitWorktreePath?.trim();
  if (wt) return wt;
  return projectPath;
}
