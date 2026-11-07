import type { ProjectRecord, SessionRecord } from '../shared/types.js';

export function isCliSession(session: Pick<SessionRecord, 'type'>): boolean {
  return !session.type;
}

/** Sessions that own a tab (everything except detached ones), in tab order. */
export function tabSessions(project: Pick<ProjectRecord, 'sessions'>): SessionRecord[] {
  return project.sessions.filter((s) => !s.detached);
}

/**
 * Where a CLI session runs: an ad-hoc location (`runPath`, plus `sshHost` when
 * remote) overrides the project; otherwise the project's own path and
 * (optional) remote host apply. `host` undefined = local.
 */
export function sessionLocation(
  project: Pick<ProjectRecord, 'path' | 'remoteHost'>,
  session: Pick<SessionRecord, 'sshHost' | 'runPath'> | undefined,
): { cwd: string; host?: string } {
  if (session?.runPath) return { cwd: session.runPath, host: session.sshHost || undefined };
  return { cwd: project.path, host: project.remoteHost };
}

/** Fixed id of the Temporary project, which holds sessions started outside every project. */
export const TEMPORARY_PROJECT_ID = 'vibeyard-temporary';

/**
 * Whether a project shows in the sidebar. The Temporary project shows only
 * while it holds a CLI session (detached ones included); its record — and so
 * its session history — is kept while hidden.
 */
export function isProjectVisible(project: Pick<ProjectRecord, 'temporary' | 'sessions'>): boolean {
  return !project.temporary || project.sessions.some(isCliSession);
}

/** Copy an ad-hoc location between record shapes; `{}` when there is none. */
export function locationFields(src: Pick<SessionRecord, 'sshHost' | 'runPath'>): Pick<SessionRecord, 'sshHost' | 'runPath'> {
  if (!src.runPath) return {};
  return src.sshHost ? { runPath: src.runPath, sshHost: src.sshHost } : { runPath: src.runPath };
}

/**
 * Restore the ordering invariant: detached sessions (tab closed, session kept)
 * sit after every tab, so tab indices equal `project.sessions` indices. Stable,
 * so tab order and detach order are both preserved. Call after any change to
 * `project.sessions` membership or to a session's `detached` flag.
 */
export function sortDetachedLast(project: Pick<ProjectRecord, 'sessions'>): void {
  if (!project.sessions.some((s) => s.detached)) return;
  project.sessions = [...tabSessions(project), ...project.sessions.filter((s) => s.detached)];
}
