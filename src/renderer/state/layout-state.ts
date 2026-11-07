import type { ProjectRecord } from '../../shared/types.js';
import { isCliSession, tabSessions } from '../session-utils.js';

/** Toggle between 'swarm' and 'tabs' layout modes. When entering swarm, reconcile splitPanes with current CLI sessions. */
export function toggleSwarmMode(project: ProjectRecord): void {
  if (project.layout.mode === 'swarm') {
    project.layout.mode = 'tabs';
    return;
  }
  const cliSessions = tabSessions(project).filter(isCliSession);
  project.layout.mode = 'swarm';
  project.layout.splitPanes = project.layout.splitPanes.filter(
    (id) => cliSessions.some((s) => s.id === id),
  );
  for (const s of cliSessions) {
    if (!project.layout.splitPanes.includes(s.id)) project.layout.splitPanes.push(s.id);
  }
}

/** Compute the next session id to activate when cycling. Returns null if there are no sessions. */
export function cycleSessionId(project: ProjectRecord, direction: 1 | -1): string | null {
  const tabs = tabSessions(project);
  if (tabs.length === 0) return null;
  const idx = tabs.findIndex((s) => s.id === project.activeSessionId);
  const next = (idx + direction + tabs.length) % tabs.length;
  return tabs[next].id;
}

/** Pick the session id at a given index, or null if out of range. */
export function sessionIdAtIndex(project: ProjectRecord, index: number): string | null {
  return tabSessions(project)[index]?.id ?? null;
}

export type RemovalMode = 'all' | 'right' | 'left' | 'others';

/** Collect the set of tab session ids targeted by a batch close (detached sessions are never included). */
export function collectRemovalIds(project: ProjectRecord, mode: RemovalMode, anchorSessionId?: string): string[] {
  const tabs = tabSessions(project);
  if (mode === 'all') return tabs.map((s) => s.id);
  if (mode === 'others' && anchorSessionId) {
    return tabs.filter((s) => s.id !== anchorSessionId).map((s) => s.id);
  }
  if ((mode === 'right' || mode === 'left') && anchorSessionId) {
    const idx = tabs.findIndex((s) => s.id === anchorSessionId);
    if (idx === -1) return [];
    return mode === 'right'
      ? tabs.slice(idx + 1).map((s) => s.id)
      : tabs.slice(0, idx).map((s) => s.id);
  }
  return [];
}

/** Move a session within project.sessions and keep splitPanes order in sync. @returns true if reordered */
export function reorderSessionInProject(project: ProjectRecord, sessionId: string, toIndex: number): boolean {
  const fromIndex = project.sessions.findIndex((s) => s.id === sessionId);
  if (fromIndex === -1 || project.sessions[fromIndex].detached) return false;
  // Detached sessions sit after every tab; a tab may never move among them.
  toIndex = Math.min(toIndex, tabSessions(project).length - 1);
  if (fromIndex === toIndex) return false;
  const [session] = project.sessions.splice(fromIndex, 1);
  project.sessions.splice(toIndex, 0, session);
  if (project.layout.splitPanes.length > 0) {
    project.layout.splitPanes = project.sessions
      .filter((s) => project.layout.splitPanes.includes(s.id))
      .map((s) => s.id);
  }
  return true;
}
