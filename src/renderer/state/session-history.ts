import type { ArchivedSession, ProjectRecord, ProviderId, SessionRecord } from '../../shared/types.js';
import { buildResumedSession, buildResumedSessionFromCliId } from './session-archive.js';

export function getSessionHistory(project: ProjectRecord | undefined): ArchivedSession[] {
  return project?.sessionHistory ?? [];
}

/** @returns true if the project has session history (regardless of whether the id matched) */
export function removeHistoryEntry(project: ProjectRecord, archivedSessionId: string): boolean {
  if (!project.sessionHistory) return false;
  project.sessionHistory = project.sessionHistory.filter((a) => a.id !== archivedSessionId);
  return true;
}

/** @returns true if a bookmark was toggled */
export function toggleBookmark(project: ProjectRecord, archivedSessionId: string): boolean {
  if (!project.sessionHistory) return false;
  const entry = project.sessionHistory.find((a) => a.id === archivedSessionId);
  if (!entry) return false;
  entry.bookmarked = !entry.bookmarked;
  return true;
}

/** Clear all non-bookmarked history entries. Always succeeds (sets to []). */
export function clearSessionHistory(project: ProjectRecord): void {
  project.sessionHistory = project.sessionHistory?.filter((a) => a.bookmarked) ?? [];
}

/** Find a session tab in this project that already has the given cliSessionId. */
export function findCliSessionTab(project: ProjectRecord, cliSessionId: string): SessionRecord | undefined {
  return project.sessions.find((s) => s.cliSessionId === cliSessionId);
}

export interface ResumeSourceData {
  providerId: ProviderId;
  cliSessionId: string | null | undefined;
  name: string;
  /** Source session's profile, so its transcript can be located in the right config dir. */
  profileId?: string;
}

/** Resolve a resume source from either an archived entry id or a live session id. */
export function resolveResumeSource(
  project: ProjectRecord,
  source: { archivedSessionId?: string; sessionId?: string },
): ResumeSourceData | undefined {
  if (source.archivedSessionId) {
    const archived = project.sessionHistory?.find((a) => a.id === source.archivedSessionId);
    if (!archived || !archived.providerId) return undefined;
    return { providerId: archived.providerId, cliSessionId: archived.cliSessionId, name: archived.name, profileId: archived.profileId };
  }
  if (source.sessionId) {
    const existing = project.sessions.find((s) => s.id === source.sessionId);
    if (!existing || !existing.providerId) return undefined;
    return { providerId: existing.providerId, cliSessionId: existing.cliSessionId, name: existing.name, profileId: existing.profileId };
  }
  return undefined;
}

export { buildResumedSession, buildResumedSessionFromCliId };
