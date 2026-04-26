import type { ArchivedSession, ProjectRecord, ProviderId, SessionRecord } from '../../shared/types.js';
import { getCost } from '../session-cost.js';

const HISTORY_CAP = 500;

/**
 * Archive a session into project.sessionHistory. If a prior history entry
 * shares the same cliSessionId, update it in place; otherwise push a new one.
 * Caps history at 500 entries while preserving bookmarked entries.
 */
export function archiveSession(project: ProjectRecord, session: SessionRecord): void {
  const costInfo = getCost(session.id);
  const archived: ArchivedSession = {
    id: crypto.randomUUID(),
    name: session.name,
    providerId: (session.providerId || 'claude') as ProviderId,
    cliSessionId: session.cliSessionId,
    createdAt: session.createdAt,
    closedAt: new Date().toISOString(),
    cost: costInfo ? {
      totalCostUsd: costInfo.totalCostUsd,
      totalInputTokens: costInfo.totalInputTokens,
      totalOutputTokens: costInfo.totalOutputTokens,
      totalDurationMs: costInfo.totalDurationMs,
    } : null,
  };

  if (!project.sessionHistory) project.sessionHistory = [];

  const existingIndex = archived.cliSessionId
    ? project.sessionHistory.findIndex((a) => a.cliSessionId === archived.cliSessionId)
    : -1;
  if (existingIndex !== -1) {
    project.sessionHistory[existingIndex].closedAt = archived.closedAt;
    if (archived.cost) project.sessionHistory[existingIndex].cost = archived.cost;
    if (archived.name !== project.sessionHistory[existingIndex].name) {
      project.sessionHistory[existingIndex].name = archived.name;
    }
  } else {
    project.sessionHistory.push(archived);
  }

  if (project.sessionHistory.length > HISTORY_CAP) {
    let nonBookmarkedToRemove = project.sessionHistory.length - HISTORY_CAP;
    project.sessionHistory = project.sessionHistory.filter((a) => {
      if (a.bookmarked) return true;
      if (nonBookmarkedToRemove > 0) { nonBookmarkedToRemove--; return false; }
      return true;
    });
  }
}

/** Build a fresh SessionRecord that resumes a previously archived CLI session. */
export function buildResumedSession(archived: ArchivedSession): SessionRecord {
  return {
    id: crypto.randomUUID(),
    name: archived.name,
    providerId: archived.providerId,
    cliSessionId: archived.cliSessionId,
    createdAt: new Date().toISOString(),
  };
}
