import type { ProjectRecord, SessionRecord } from '../shared/types.js';

export function isCliSession(session: Pick<SessionRecord, 'type'>): boolean {
  return !session.type;
}

/** Sessions that own a tab (everything except detached ones), in tab order. */
export function tabSessions(project: Pick<ProjectRecord, 'sessions'>): SessionRecord[] {
  return project.sessions.filter((s) => !s.detached);
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
