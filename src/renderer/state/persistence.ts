import type { BoardColumn, BoardData, PersistedState, Preferences, ProjectRecord, SessionRecord } from '../../shared/types.js';
import { restoreCost } from '../session-cost.js';
import { restoreContext } from '../session-context.js';
import { buildKanbanSession } from './session-factory.js';
import { sortDetachedLast, tabSessions } from '../session-utils.js';
import { normalizeProjectColor } from '../project-colors.js';

export function createDefaultBoard(): BoardData {
  const columns: BoardColumn[] = [
    { id: crypto.randomUUID(), title: 'Backlog', order: 0, behavior: 'inbox' },
    { id: crypto.randomUUID(), title: 'Ready',   order: 1, behavior: 'none' },
    { id: crypto.randomUUID(), title: 'Running', order: 2, behavior: 'active' },
    { id: crypto.randomUUID(), title: 'Done',    order: 3, behavior: 'terminal' },
  ];
  return { columns, tasks: [] };
}

/**
 * Apply forward-compat migrations and runtime priming to a freshly-loaded state.
 * Mutates `state` in place.
 */
export function hydrateLoadedState(state: PersistedState, defaultPreferences: Preferences): void {
  state.preferences = { ...defaultPreferences, ...state.preferences };
  for (const project of state.projects) {
    for (const session of project.sessions) {
      if (session.cost) restoreCost(session.id, session.cost);
      if (session.contextWindow) restoreContext(session.id, session.contextWindow);
    }
    if (project.sessionHistory) {
      const seenIds = new Set<string>();
      for (const entry of project.sessionHistory) {
        if (seenIds.has(entry.id)) entry.id = crypto.randomUUID();
        seenIds.add(entry.id);
      }
    }
  }
}

/**
 * Ensure every project has a board, clear stale runtime sessionIds on board tasks,
 * and migrate the legacy `layout.mode === 'board'` to a kanban tab session.
 */
export function ensureProjectDefaults(state: PersistedState): void {
  for (const project of state.projects) {
    // Temporary sessions are ephemeral; drop any history an older build kept.
    if (project.temporary) delete project.sessionHistory;
    if (!project.board) project.board = createDefaultBoard();
    // Renderers trust project.color to be canonical #rrggbb; drop anything else.
    const color = normalizeProjectColor(project.color);
    if (color) project.color = color;
    else delete project.color;
    for (const task of project.board.tasks) task.sessionId = undefined;

    const legacyMode = (project.layout as { mode: string }).mode;
    if (legacyMode === 'board') {
      project.layout.mode = 'tabs';
      const existingKanban = project.sessions.find((s) => s.type === 'kanban');
      const kanbanSession = existingKanban ?? buildKanbanSession({ projectName: project.name });
      if (!existingKanban) project.sessions.push(kanbanSession);
      project.activeSessionId = kanbanSession.id;
    }

    // Detached sessions (tab closed, session kept) live after every tab and are
    // never the active tab or a split/swarm pane.
    sortDetachedLast(project);
    const detachedIds = new Set(project.sessions.filter((s) => s.detached).map((s) => s.id));
    if (detachedIds.size > 0) {
      project.layout.splitPanes = project.layout.splitPanes.filter((id) => !detachedIds.has(id));
      if (project.activeSessionId && detachedIds.has(project.activeSessionId)) {
        project.activeSessionId = tabSessions(project)[0]?.id ?? null;
      }
    }
  }
}

/**
 * Strip transient fields that should never be persisted (in-flight prompts).
 */
export function serializeForSave(state: PersistedState): PersistedState {
  return {
    ...state,
    projects: state.projects.map((p: ProjectRecord) => ({
      ...p,
      sessions: p.sessions.map(({ pendingInitialPrompt, pendingSystemPrompt, pendingCliName, ...rest }: SessionRecord) => rest as SessionRecord),
    })),
  };
}
