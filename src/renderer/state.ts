import type { VibeyardApi } from './types.js';
import type { SessionRecord, ProjectRecord, Preferences, PersistedState, ArchivedSession, ProviderId, CostInfo, ContextWindowInfo, InitialContextSnapshot, ReadinessResult } from '../shared/types.js';
import { getCost, restoreCost } from './session-cost.js';
import { restoreContext } from './session-context.js';

export type { SessionRecord, ProjectRecord, Preferences, PersistedState, ArchivedSession } from '../shared/types.js';

export const MAX_SESSION_NAME_LENGTH = 60;

declare global {
  interface Window {
    vibeyard: VibeyardApi;
  }
}

type EventType =
  | 'project-added'
  | 'project-removed'
  | 'project-changed'
  | 'session-added'
  | 'session-removed'
  | 'session-changed'
  | 'layout-changed'
  | 'preferences-changed'
  | 'terminal-panel-changed'
  | 'history-changed'
  | 'insights-changed'
  | 'readiness-changed'
  | 'sidebar-toggled'
  | 'state-loaded';

type EventCallback = (data?: unknown) => void;

const defaultPreferences: Preferences = {
  soundOnSessionWaiting: true,
  debugMode: false,
  sessionHistoryEnabled: true,
  insightsEnabled: true,
  autoTitleEnabled: true,
  sidebarViews: { configSections: true, gitPanel: true, sessionHistory: true, costFooter: true, readinessSection: true },
};

class AppState {
  private state: PersistedState = { version: 1, projects: [], activeProjectId: null, preferences: { ...defaultPreferences } };
  private listeners = new Map<EventType, Set<EventCallback>>();

  on(event: EventType, cb: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb);
    return () => this.listeners.get(event)?.delete(cb);
  }

  private emit(event: EventType, data?: unknown): void {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  async load(): Promise<void> {
    const loaded = (await window.vibeyard.store.load()) as PersistedState | null;
    if (loaded && loaded.version === 1) {
      this.state = loaded;
      // Merge defaults for forward compatibility with old state files
      this.state.preferences = { ...defaultPreferences, ...this.state.preferences };
      // Restore persisted cost data into the in-memory cost tracker
      for (const project of this.state.projects) {
        for (const session of project.sessions) {
          if (session.cost) {
            restoreCost(session.id, session.cost);
          }
          if (session.contextWindow) {
            restoreContext(session.id, session.contextWindow);
          }
        }
      }
    }
    this.emit('state-loaded');
  }

  private persist(): void {
    window.vibeyard.store.save(this.state);
  }

  get projects(): ProjectRecord[] {
    return this.state.projects;
  }

  get activeProjectId(): string | null {
    return this.state.activeProjectId;
  }

  get activeProject(): ProjectRecord | undefined {
    return this.state.projects.find((p) => p.id === this.state.activeProjectId);
  }

  get activeSession(): SessionRecord | undefined {
    const project = this.activeProject;
    if (!project) return undefined;
    return project.sessions.find((s) => s.id === project.activeSessionId);
  }

  get sidebarWidth(): number | undefined {
    return this.state.sidebarWidth;
  }

  setSidebarWidth(width: number): void {
    this.state.sidebarWidth = width;
    this.persist();
  }

  get sidebarCollapsed(): boolean {
    return this.state.sidebarCollapsed ?? false;
  }

  toggleSidebar(): void {
    this.state.sidebarCollapsed = !this.sidebarCollapsed;
    this.persist();
    this.emit('sidebar-toggled');
  }

  setTerminalPanelOpen(open: boolean): void {
    const project = this.activeProject;
    if (!project) return;
    project.terminalPanelOpen = open;
    this.persist();
    this.emit('terminal-panel-changed');
  }

  setTerminalPanelHeight(height: number): void {
    const project = this.activeProject;
    if (!project) return;
    project.terminalPanelHeight = height;
    this.persist();
  }

  get preferences(): Preferences {
    return this.state.preferences;
  }

  setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
    this.state.preferences[key] = value;
    this.persist();
    this.emit('preferences-changed');
  }

  setActiveProject(id: string | null): void {
    this.state.activeProjectId = id;
    this.persist();
    this.emit('project-changed');
  }

  addProject(name: string, path: string): ProjectRecord {
    const project: ProjectRecord = {
      id: crypto.randomUUID(),
      name,
      path,
      sessions: [],
      activeSessionId: null,
      layout: { mode: 'swarm', splitPanes: [], splitDirection: 'horizontal' },
    };
    this.state.projects.push(project);
    this.state.activeProjectId = project.id;
    this.persist();
    this.emit('project-added', project);
    this.emit('project-changed');
    return project;
  }

  removeProject(id: string): void {
    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    if (this.state.activeProjectId === id) {
      this.state.activeProjectId = this.state.projects[0]?.id ?? null;
    }
    this.persist();
    this.emit('project-removed', id);
    this.emit('project-changed');
  }

  addSession(projectId: string, name: string, args?: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    const effectiveArgs = args ?? project.defaultArgs;
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      name,
      ...(effectiveArgs ? { args: effectiveArgs } : {}),
      cliSessionId: null,
      createdAt: new Date().toISOString(),
    };
    project.sessions.push(session);
    project.activeSessionId = session.id;
    // Auto-add to swarm if in swarm mode and under limit
    if (project.layout.mode === 'swarm') {
      project.layout.splitPanes.push(session.id);
    }
    this.persist();
    this.emit('session-added', { projectId, session });
    this.emit('session-changed');
    return session;
  }

  addDiffViewerSession(projectId: string, filePath: string, area: string, worktreePath?: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    // If a diff tab for this file+area+worktree already exists, just switch to it
    const existing = project.sessions.find(
      (s) => s.type === 'diff-viewer' && s.diffFilePath === filePath && s.diffArea === area && s.worktreePath === worktreePath
    );
    if (existing) {
      project.activeSessionId = existing.id;
      this.persist();
      this.emit('session-changed');
      return existing;
    }

    const name = filePath.split('/').pop() || filePath;
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      name,
      type: 'diff-viewer',
      diffFilePath: filePath,
      diffArea: area,
      ...(worktreePath ? { worktreePath } : {}),
      cliSessionId: null,
      createdAt: new Date().toISOString(),
    };
    project.sessions.push(session);
    project.activeSessionId = session.id;
    this.persist();
    this.emit('session-added', { projectId, session });
    this.emit('session-changed');
    return session;
  }

  addFileReaderSession(projectId: string, filePath: string, lineNumber?: number): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    // If a file-reader tab for this path already exists, just switch to it
    const existing = project.sessions.find(
      (s) => s.type === 'file-reader' && s.fileReaderPath === filePath
    );
    if (existing) {
      existing.fileReaderLine = lineNumber;
      project.activeSessionId = existing.id;
      this.persist();
      this.emit('session-changed');
      return existing;
    }

    const name = filePath.split('/').pop() || filePath;
    const session: SessionRecord = {
      id: crypto.randomUUID(),
      name,
      type: 'file-reader',
      fileReaderPath: filePath,
      ...(lineNumber !== undefined ? { fileReaderLine: lineNumber } : {}),
      cliSessionId: null,
      createdAt: new Date().toISOString(),
    };
    project.sessions.push(session);
    project.activeSessionId = session.id;
    this.persist();
    this.emit('session-added', { projectId, session });
    this.emit('session-changed');
    return session;
  }

  addMcpInspectorSession(projectId: string, name: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    const session: SessionRecord = {
      id: crypto.randomUUID(),
      name,
      type: 'mcp-inspector',
      cliSessionId: null,
      createdAt: new Date().toISOString(),
    };
    project.sessions.push(session);
    project.activeSessionId = session.id;
    this.persist();
    this.emit('session-added', { projectId, session });
    this.emit('session-changed');
    return session;
  }

  removeSession(projectId: string, sessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;

    // Archive CLI sessions before removing (cost data must be captured before session-removed triggers destroyTerminal)
    const session = project.sessions.find((s) => s.id === sessionId);
    if (session && (!session.type || session.type === 'claude') && this.state.preferences.sessionHistoryEnabled) {
      // Skip archiving empty sessions (no CLI activity)
      if (session.cliSessionId || getCost(session.id) !== null) {
        this.archiveSession(project, session);
      }
    }

    const closingIndex = project.sessions.findIndex((s) => s.id === sessionId);
    project.sessions = project.sessions.filter((s) => s.id !== sessionId);
    if (project.activeSessionId === sessionId) {
      const newIndex = closingIndex > 0 ? closingIndex - 1 : 0;
      project.activeSessionId = project.sessions[newIndex]?.id ?? null;
    }
    // Also remove from split/swarm panes
    project.layout.splitPanes = project.layout.splitPanes.filter((id) => id !== sessionId);
    this.persist();
    this.emit('session-removed', { projectId, sessionId });
    this.emit('session-changed');
  }

  private archiveSession(project: ProjectRecord, session: SessionRecord): void {
    const costInfo = getCost(session.id);
    const archived: ArchivedSession = {
      id: session.id,
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

    // If a history entry with the same cliSessionId exists, update it instead of creating a duplicate
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

    // Cap at 500 entries per project
    if (project.sessionHistory.length > 500) {
      project.sessionHistory = project.sessionHistory.slice(-500);
    }

    this.emit('history-changed', project.id);
  }

  getSessionHistory(projectId: string): ArchivedSession[] {
    const project = this.state.projects.find((p) => p.id === projectId);
    return project?.sessionHistory ?? [];
  }

  removeHistoryEntry(projectId: string, archivedSessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project?.sessionHistory) return;
    project.sessionHistory = project.sessionHistory.filter((a) => a.id !== archivedSessionId);
    this.persist();
    this.emit('history-changed', projectId);
  }

  clearSessionHistory(projectId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.sessionHistory = [];
    this.persist();
    this.emit('history-changed', projectId);
  }

  resumeFromHistory(projectId: string, archivedSessionId: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    const archived = project.sessionHistory?.find((a) => a.id === archivedSessionId);
    if (!archived || !archived.cliSessionId) return undefined;

    // If a tab with the same cliSessionId is already open, just activate it
    const existing = project.sessions.find((s) => s.cliSessionId === archived.cliSessionId);
    if (existing) {
      project.activeSessionId = existing.id;
      this.persist();
      this.emit('session-changed');
      return existing;
    }

    const session: SessionRecord = {
      id: crypto.randomUUID(),
      name: archived.name,
      providerId: archived.providerId,
      cliSessionId: archived.cliSessionId,
      createdAt: new Date().toISOString(),
    };
    project.sessions.push(session);
    project.activeSessionId = session.id;
    // Auto-add to swarm if in swarm mode
    if (project.layout.mode === 'swarm') {
      project.layout.splitPanes.push(session.id);
    }
    this.persist();
    this.emit('session-added', { projectId, session });
    this.emit('session-changed');
    return session;
  }

  setActiveSession(projectId: string, sessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.activeSessionId = sessionId;
    this.persist();
    this.emit('session-changed');
  }

  updateSessionCliId(projectId: string, sessionId: string, cliSessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const session = project.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    // If session already had a different cliSessionId (e.g., /clear was used),
    // archive the previous session and reset the tab name
    if (session.cliSessionId && session.cliSessionId !== cliSessionId) {
      this.archiveSession(project, session);
      session.name = `Session ${project.sessions.length + (project.sessionHistory?.length || 0)}`;
      session.userRenamed = false;
    }

    session.cliSessionId = cliSessionId;
    this.persist();
    this.emit('session-changed');
  }

  /** @deprecated Use updateSessionCliId */
  updateSessionClaudeId(projectId: string, sessionId: string, claudeSessionId: string): void {
    this.updateSessionCliId(projectId, sessionId, claudeSessionId);
  }

  private findSessionById(sessionId: string): SessionRecord | undefined {
    for (const project of this.state.projects) {
      const session = project.sessions.find((s) => s.id === sessionId);
      if (session) return session;
    }
    return undefined;
  }

  updateSessionCost(sessionId: string, cost: CostInfo): void {
    const session = this.findSessionById(sessionId);
    if (!session) return;
    session.cost = { ...cost };
    this.persist();
  }

  updateSessionContext(sessionId: string, context: ContextWindowInfo): void {
    const session = this.findSessionById(sessionId);
    if (!session) return;
    session.contextWindow = { ...context };
    this.persist();
  }

  renameSession(projectId: string, sessionId: string, name: string, userRenamed?: boolean): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const session = project.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    session.name = name.slice(0, MAX_SESSION_NAME_LENGTH);
    if (userRenamed) session.userRenamed = true;
    // Keep history entry in sync if this session was resumed from history
    if (session.cliSessionId && project.sessionHistory) {
      const historyEntry = project.sessionHistory.find((a) => a.cliSessionId === session.cliSessionId);
      if (historyEntry) {
        historyEntry.name = session.name;
        this.emit('history-changed', project.id);
      }
    }
    this.persist();
    this.emit('session-changed');
  }

  toggleSplit(): void {
    this.toggleSwarm();
  }

  toggleSwarm(): void {
    const project = this.activeProject;
    if (!project) return;

    if (project.layout.mode === 'swarm') {
      project.layout.mode = 'tabs';
      project.layout.splitPanes = [];
    } else {
      const cliSessions = project.sessions.filter(
        (s) => !s.type || s.type === 'claude'
      );
      project.layout.mode = 'swarm';
      project.layout.splitPanes = [];

      if (project.activeSessionId && cliSessions.some((s) => s.id === project.activeSessionId)) {
        project.layout.splitPanes.push(project.activeSessionId);
      }

      for (const s of cliSessions) {
        if (!project.layout.splitPanes.includes(s.id)) {
          project.layout.splitPanes.push(s.id);
        }
      }
    }
    this.persist();
    this.emit('layout-changed');
  }

  cycleSession(direction: 1 | -1): void {
    const project = this.activeProject;
    if (!project || project.sessions.length === 0) return;
    const idx = project.sessions.findIndex((s) => s.id === project.activeSessionId);
    const next = (idx + direction + project.sessions.length) % project.sessions.length;
    project.activeSessionId = project.sessions[next].id;
    this.persist();
    this.emit('session-changed');
  }

  gotoSession(index: number): void {
    const project = this.activeProject;
    if (!project || index >= project.sessions.length) return;
    project.activeSessionId = project.sessions[index].id;
    this.persist();
    this.emit('session-changed');
  }

  removeAllSessions(projectId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const ids = project.sessions.map((s) => s.id);
    for (const id of ids) this.removeSession(projectId, id);
  }

  removeSessionsFromRight(projectId: string, sessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const idx = project.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) return;
    const ids = project.sessions.slice(idx + 1).map((s) => s.id);
    for (const id of ids) this.removeSession(projectId, id);
  }

  removeSessionsFromLeft(projectId: string, sessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const idx = project.sessions.findIndex((s) => s.id === sessionId);
    if (idx === -1) return;
    const ids = project.sessions.slice(0, idx).map((s) => s.id);
    for (const id of ids) this.removeSession(projectId, id);
  }

  removeOtherSessions(projectId: string, sessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const ids = project.sessions.filter((s) => s.id !== sessionId).map((s) => s.id);
    for (const id of ids) this.removeSession(projectId, id);
  }

  addInsightSnapshot(projectId: string, snapshot: InitialContextSnapshot): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    if (!project.insights) project.insights = { initialContextSnapshots: [], dismissed: [] };
    project.insights.initialContextSnapshots.push(snapshot);
    // Cap at 50 snapshots
    if (project.insights.initialContextSnapshots.length > 50) {
      project.insights.initialContextSnapshots = project.insights.initialContextSnapshots.slice(-50);
    }
    this.persist();
    this.emit('insights-changed', projectId);
  }

  dismissInsight(projectId: string, insightId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    if (!project.insights) project.insights = { initialContextSnapshots: [], dismissed: [] };
    if (!project.insights.dismissed.includes(insightId)) {
      project.insights.dismissed.push(insightId);
    }
    this.persist();
    this.emit('insights-changed', projectId);
  }

  isInsightDismissed(projectId: string, insightId: string): boolean {
    const project = this.state.projects.find((p) => p.id === projectId);
    return project?.insights?.dismissed.includes(insightId) ?? false;
  }

  setProjectReadiness(projectId: string, result: ReadinessResult): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.readiness = result;
    this.persist();
    this.emit('readiness-changed', projectId);
  }

  reorderSession(projectId: string, sessionId: string, toIndex: number): void {
    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) return;
    const fromIndex = project.sessions.findIndex(s => s.id === sessionId);
    if (fromIndex === -1 || fromIndex === toIndex) return;
    const [session] = project.sessions.splice(fromIndex, 1);
    project.sessions.splice(toIndex, 0, session);
    // Keep splitPanes in sync with sessions order
    if (project.layout.splitPanes.length > 0) {
      project.layout.splitPanes = project.sessions
        .filter(s => project.layout.splitPanes.includes(s.id))
        .map(s => s.id);
    }
    this.persist();
    this.emit('session-changed');
  }
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  (appState as any)['state'] = { version: 1, projects: [], activeProjectId: null, preferences: { ...defaultPreferences } };
  (appState as any)['listeners'] = new Map();
}

export const appState = new AppState();
