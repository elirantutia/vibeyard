import type { VibeyardApi } from './types.js';
import type { SessionRecord, ProjectRecord, Preferences, PersistedState, ArchivedSession, ProviderId, CostInfo, ContextWindowInfo, InitialContextSnapshot, ReadinessResult, BoardColumn, BoardData } from '../shared/types.js';
import { getCost, restoreCost } from './session-cost.js';
import { restoreContext } from './session-context.js';
import { getProviderCapabilities, getProviderAvailabilitySnapshot } from './provider-availability.js';
import { basename } from '../shared/platform.js';
import { isCliSession } from './session-utils.js';
import { archiveSession as archiveSessionPure, buildResumedSession, buildResumedSessionFromCliId } from './state/session-archive.js';
import {
  attachSessionToProject,
  buildBrowserTabSession,
  buildCliSession,
  buildDiffViewerSession,
  buildFileReaderSession,
  buildKanbanSession,
  buildMcpInspectorSession,
  buildProjectTabSession,
  buildRemoteSession,
} from './state/session-factory.js';
import { NavHistory } from './state/nav-history.js';

export type { SessionRecord, ProjectRecord, Preferences, PersistedState, ArchivedSession } from '../shared/types.js';

export const MAX_SESSION_NAME_LENGTH = 60;
export const MAX_PROJECT_NAME_LENGTH = 80;

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
  | 'cli-session-cleared'
  | 'board-changed'
  | 'state-loaded';

type EventCallback = (data?: unknown) => void;

const defaultPreferences: Preferences = {
  soundOnSessionWaiting: true,
  notificationsDesktop: true,
  debugMode: false,
  sessionHistoryEnabled: true,
  insightsEnabled: true,
  autoTitleEnabled: true,
  confirmCloseWorkingSession: true,
  copyOnSelect: false,
  zoomFactor: 1.0,
  readinessExcludedProviders: [],
  sidebarViews: { gitPanel: true, sessionHistory: true, costFooter: true, discussions: true, fileTree: true },
};

class AppState {
  private state: PersistedState = { version: 1, projects: [], activeProjectId: null, preferences: { ...defaultPreferences } };
  private listeners = new Map<EventType, Set<EventCallback>>();
  private nav = new NavHistory();

  private pushNav(sessionId: string | null | undefined): void {
    this.nav.push(sessionId);
  }

  private pruneNav(sessionId: string): void {
    this.nav.prune(sessionId);
  }

  private findProjectBySession(sessionId: string): ProjectRecord | undefined {
    return this.state.projects.find((p) => p.sessions.some((s) => s.id === sessionId));
  }

  navigateBack(): void {
    this.stepNav(-1);
  }

  navigateForward(): void {
    this.stepNav(1);
  }

  private stepNav(direction: 1 | -1): void {
    const id = this.nav.findNextValid(direction, (sid) => !!this.findProjectBySession(sid));
    if (!id) return;
    const project = this.findProjectBySession(id)!;
    this.nav.withSuppression(() => {
      const projectChanged = this.state.activeProjectId !== project.id;
      this.state.activeProjectId = project.id;
      project.activeSessionId = id;
      this.persist();
      if (projectChanged) this.emit('project-changed');
      this.emit('session-changed');
    });
  }

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
        // Migrate duplicate archived session IDs (caused by /clear creating two entries with same id)
        if (project.sessionHistory) {
          const seenIds = new Set<string>();
          for (const entry of project.sessionHistory) {
            if (seenIds.has(entry.id)) {
              entry.id = crypto.randomUUID();
            }
            seenIds.add(entry.id);
          }
        }
      }
    }
    // Ensure all projects have board data; clear stale runtime sessionIds
    for (const project of this.state.projects) {
      if (!project.board) {
        project.board = createDefaultBoard();
      }
      for (const task of project.board.tasks) {
        task.sessionId = undefined;
      }
      // Migrate legacy layout.mode === 'board' to a kanban tab session
      const legacyMode = (project.layout as { mode: string }).mode;
      if (legacyMode === 'board') {
        project.layout.mode = 'tabs';
        const existingKanban = project.sessions.find((s) => s.type === 'kanban');
        const kanbanSession = existingKanban ?? buildKanbanSession({ projectName: project.name });
        if (!existingKanban) {
          project.sessions.push(kanbanSession);
        }
        project.activeSessionId = kanbanSession.id;
      }
    }

    if (!this.state.starPromptDismissed) {
      this.state.appLaunchCount = (this.state.appLaunchCount ?? 0) + 1;
      this.persist();
    }

    this.emit('state-loaded');
  }

  private persist(): void {
    // Strip transient fields before saving
    const toSave = {
      ...this.state,
      projects: this.state.projects.map((p) => ({
        ...p,
        sessions: p.sessions.map(({ pendingInitialPrompt, ...rest }) => rest),
      })),
    };
    window.vibeyard.store.save(toSave);
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

  get discussionsLastSeen(): string | undefined {
    return this.state.discussionsLastSeen;
  }

  setDiscussionsLastSeen(timestamp: string): void {
    this.state.discussionsLastSeen = timestamp;
    this.persist();
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

  get lastSeenVersion(): string | undefined {
    return this.state.lastSeenVersion;
  }

  setLastSeenVersion(version: string): void {
    this.state.lastSeenVersion = version;
    this.persist();
  }

  get appLaunchCount(): number {
    return this.state.appLaunchCount ?? 0;
  }

  get starPromptDismissed(): boolean {
    return this.state.starPromptDismissed ?? false;
  }

  dismissStarPrompt(): void {
    this.state.starPromptDismissed = true;
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
    const project = this.state.projects.find((p) => p.id === id);
    if (project?.activeSessionId) this.pushNav(project.activeSessionId);
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
    const project = this.state.projects.find((p) => p.id === id);
    const sessions = project?.sessions ?? [];

    this.state.projects = this.state.projects.filter((p) => p.id !== id);
    if (this.state.activeProjectId === id) {
      this.state.activeProjectId = this.state.projects[0]?.id ?? null;
    }
    this.persist();
    for (const session of sessions) {
      this.emit('session-removed', { projectId: id, sessionId: session.id });
    }
    this.emit('project-removed', id);
    this.emit('project-changed');
  }

  renameProject(id: string, name: string): void {
    const project = this.state.projects.find((p) => p.id === id);
    if (!project) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === project.name) return;
    project.name = trimmed.slice(0, MAX_PROJECT_NAME_LENGTH);
    this.persist();
    this.emit('project-changed');
  }

  addPlanSession(
    projectId: string,
    name: string,
    planMode: boolean = true,
    providerIdOverride?: ProviderId,
  ): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;
    const activeSession = project.sessions.find((s) => s.id === project.activeSessionId);
    const providerId =
      providerIdOverride
      ?? activeSession?.providerId
      ?? this.state.preferences.defaultProvider
      ?? 'claude';
    const caps = getProviderCapabilities(providerId);
    const planArg = planMode ? (caps?.planModeArg ?? '') : '';
    const base = project.defaultArgs ?? '';
    const args = [base, planArg].filter(Boolean).join(' ').trim() || undefined;
    return this.addSession(projectId, name, args, providerId);
  }

  addSession(projectId: string, name: string, args?: string, providerId?: ProviderId): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    const session = buildCliSession({
      name,
      providerId: providerId ?? this.state.preferences.defaultProvider ?? 'claude',
      args: args ?? project.defaultArgs,
    });
    attachSessionToProject(project, session, { addToSwarm: true });
    this.commitNewSession(projectId, session);
    return session;
  }

  private activateExistingSession(project: ProjectRecord, existing: SessionRecord): SessionRecord {
    if (project.activeSessionId !== existing.id) {
      project.activeSessionId = existing.id;
      this.pushNav(existing.id);
      this.persist();
      this.emit('session-changed');
    }
    return existing;
  }

  private commitNewSession(projectId: string, session: SessionRecord): void {
    this.pushNav(session.id);
    this.persist();
    this.emit('session-added', { projectId, session });
    this.emit('session-changed');
  }

  addDiffViewerSession(projectId: string, filePath: string, area: string, worktreePath?: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    // If a diff tab for this file+area+worktree already exists, just switch to it
    const existing = project.sessions.find(
      (s) => s.type === 'diff-viewer' && s.diffFilePath === filePath && s.diffArea === area && s.worktreePath === worktreePath
    );
    if (existing) return this.activateExistingSession(project, existing);

    const session = buildDiffViewerSession({ name: basename(filePath), filePath, area, worktreePath });
    attachSessionToProject(project, session);
    this.commitNewSession(projectId, session);
    return session;
  }

  addRemoteSession(projectId: string, sessionId: string, hostSessionName: string, shareMode: 'readonly' | 'readwrite'): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    const session = buildRemoteSession({ id: sessionId, name: `Remote: ${hostSessionName}`, remoteHostName: hostSessionName, shareMode });
    attachSessionToProject(project, session);
    this.commitNewSession(projectId, session);
    return session;
  }

  addBrowserTabSession(projectId: string, url?: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    // If a browser-tab with the same URL already exists, switch to it
    if (url) {
      const existing = project.sessions.find(
        (s) => s.type === 'browser-tab' && s.browserTabUrl === url
      );
      if (existing) return this.activateExistingSession(project, existing);
    }

    let name = 'Browser';
    if (url) {
      try { name = new URL(url).hostname || url; } catch { name = url; }
    }
    const session = buildBrowserTabSession({ name, url });
    attachSessionToProject(project, session);
    this.commitNewSession(projectId, session);
    return session;
  }

  openProjectTab(projectId: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    if (this.state.activeProjectId !== projectId) {
      this.setActiveProject(projectId);
    }

    const existing = project.sessions.find((s) => s.type === 'project-tab');
    if (existing) return this.activateExistingSession(project, existing);

    const session = buildProjectTabSession({ projectName: project.name });
    attachSessionToProject(project, session);
    this.commitNewSession(projectId, session);
    return session;
  }

  openKanbanTab(projectId: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    if (this.state.activeProjectId !== projectId) {
      this.setActiveProject(projectId);
    }

    const existing = project.sessions.find((s) => s.type === 'kanban');
    if (existing) return this.activateExistingSession(project, existing);

    const session = buildKanbanSession({ projectName: project.name });
    attachSessionToProject(project, session);
    this.commitNewSession(projectId, session);
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
      const lineChanged = existing.fileReaderLine !== lineNumber;
      const activating = project.activeSessionId !== existing.id;
      existing.fileReaderLine = lineNumber;
      if (activating) {
        project.activeSessionId = existing.id;
        this.pushNav(existing.id);
      }
      // Emit even when the tab is already active so renderLayout re-runs
      // setFileReaderLine and scrolls to the new position.
      if (activating || lineChanged) {
        this.persist();
        this.emit('session-changed');
      }
      return existing;
    }

    const session = buildFileReaderSession({ name: basename(filePath), filePath, lineNumber });
    attachSessionToProject(project, session);
    this.commitNewSession(projectId, session);
    return session;
  }

  addMcpInspectorSession(projectId: string, name: string): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    const session = buildMcpInspectorSession({ name });
    attachSessionToProject(project, session);
    this.commitNewSession(projectId, session);
    return session;
  }

  removeSession(projectId: string, sessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;

    // Archive CLI sessions before removing (cost data must be captured before session-removed triggers destroyTerminal)
    const session = project.sessions.find((s) => s.id === sessionId);
    if (session && isCliSession(session) && this.state.preferences.sessionHistoryEnabled) {
      // Skip archiving empty sessions (no CLI activity)
      if (session.cliSessionId || getCost(session.id) !== null) {
        this.archiveSession(project, session);
      }
    }

    const closingIndex = project.sessions.findIndex((s) => s.id === sessionId);
    project.sessions = project.sessions.filter((s) => s.id !== sessionId);
    this.pruneNav(sessionId);
    if (project.activeSessionId === sessionId) {
      const newIndex = closingIndex > 0 ? closingIndex - 1 : 0;
      project.activeSessionId = project.sessions[newIndex]?.id ?? null;
      if (project.activeSessionId) this.pushNav(project.activeSessionId);
    }
    // Also remove from split/swarm panes
    project.layout.splitPanes = project.layout.splitPanes.filter((id) => id !== sessionId);
    this.persist();
    this.emit('session-removed', { projectId, sessionId });
    this.emit('session-changed');
  }

  private archiveSession(project: ProjectRecord, session: SessionRecord): void {
    archiveSessionPure(project, session);
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

  toggleBookmark(projectId: string, archivedSessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project?.sessionHistory) return;
    const entry = project.sessionHistory.find((a) => a.id === archivedSessionId);
    if (!entry) return;
    entry.bookmarked = !entry.bookmarked;
    this.persist();
    this.emit('history-changed', projectId);
  }

  clearSessionHistory(projectId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.sessionHistory = project.sessionHistory?.filter((a) => a.bookmarked) ?? [];
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
    if (existing) return this.activateExistingSession(project, existing);

    const session = buildResumedSession(archived);
    attachSessionToProject(project, session, { addToSwarm: true });
    this.commitNewSession(projectId, session);
    return session;
  }

  /** Open a CLI session by cliSessionId, bypassing Vibeyard history. Used for cross-project deep search results. */
  openCliSession(projectId: string, cliSessionId: string, name: string, providerId: ProviderId = 'claude'): SessionRecord | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    const existing = project.sessions.find((s) => s.cliSessionId === cliSessionId);
    if (existing) return this.activateExistingSession(project, existing);

    const session = buildResumedSessionFromCliId(cliSessionId, name, providerId);
    attachSessionToProject(project, session, { addToSwarm: true });
    this.commitNewSession(projectId, session);
    return session;
  }

  async resumeWithProvider(
    projectId: string,
    source: { archivedSessionId?: string; sessionId?: string },
    targetProviderId: ProviderId,
  ): Promise<SessionRecord | undefined> {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return undefined;

    // Defense-in-depth: UI gates this by availability, but bail if the target
    // provider isn't actually installed so we don't create a broken session.
    const snapshot = getProviderAvailabilitySnapshot();
    if (snapshot && snapshot.availability.get(targetProviderId) === false) {
      return undefined;
    }

    let sourceProviderId: ProviderId | undefined;
    let sourceCliSessionId: string | null = null;
    let sourceName = 'session';
    if (source.archivedSessionId) {
      const archived = project.sessionHistory?.find((a) => a.id === source.archivedSessionId);
      if (!archived) return undefined;
      sourceProviderId = archived.providerId;
      sourceCliSessionId = archived.cliSessionId;
      sourceName = archived.name;
    } else if (source.sessionId) {
      const existing = project.sessions.find((s) => s.id === source.sessionId);
      if (!existing) return undefined;
      sourceProviderId = existing.providerId;
      sourceCliSessionId = existing.cliSessionId;
      sourceName = existing.name;
    } else {
      return undefined;
    }
    if (!sourceProviderId) return undefined;

    const initialPrompt = await window.vibeyard.session.buildResumeWithPrompt(
      sourceProviderId,
      sourceCliSessionId,
      project.path,
      sourceName,
    );

    const session: SessionRecord = {
      ...buildCliSession({ name: `${sourceName} (↪ ${targetProviderId})`, providerId: targetProviderId }),
      pendingInitialPrompt: initialPrompt,
    };
    attachSessionToProject(project, session, { addToSwarm: true });
    // commitNewSession persist()s before emitting session-added; persist strips
    // the transient pendingInitialPrompt, but split-layout.onSessionAdded reads
    // it from in-memory state synchronously inside the emit.
    this.commitNewSession(projectId, session);
    return session;
  }

  consumePendingInitialPrompt(projectId: string, sessionId: string): string | undefined {
    const project = this.state.projects.find((p) => p.id === projectId);
    const session = project?.sessions.find((s) => s.id === sessionId);
    if (!session?.pendingInitialPrompt) return undefined;
    const prompt = session.pendingInitialPrompt;
    delete session.pendingInitialPrompt;
    return prompt;
  }

  setActiveSession(projectId: string, sessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.activeSessionId = sessionId;
    this.pushNav(sessionId);
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
      this.emit('cli-session-cleared', { sessionId });
    }

    session.cliSessionId = cliSessionId;
    this.persist();
    this.emit('session-changed');
  }

  /** @deprecated Use updateSessionCliId */
  updateSessionClaudeId(projectId: string, sessionId: string, claudeSessionId: string): void {
    this.updateSessionCliId(projectId, sessionId, claudeSessionId);
  }

  hasSession(sessionId: string): boolean {
    return this.findSessionById(sessionId) !== undefined;
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

  updateSessionBrowserTabUrl(sessionId: string, url: string): void {
    const session = this.findSessionById(sessionId);
    if (!session || session.browserTabUrl === url) return;
    session.browserTabUrl = url;
    this.persist();
  }

  renameSession(projectId: string, sessionId: string, name: string, userRenamed?: boolean): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const session = project.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (session.type === 'kanban' || session.type === 'project-tab') return;
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

  notifyBoardChanged(): void {
    this.persist();
    this.emit('board-changed');
  }

  toggleSplit(): void {
    this.toggleSwarm();
  }

  toggleSwarm(): void {
    const project = this.activeProject;
    if (!project) return;

    if (project.layout.mode === 'swarm') {
      project.layout.mode = 'tabs';
      // Keep splitPanes as-is so order is preserved when switching back
    } else {
      const cliSessions = project.sessions.filter(isCliSession);
      project.layout.mode = 'swarm';

      // Remove stale IDs (deleted sessions)
      project.layout.splitPanes = project.layout.splitPanes.filter(
        (id) => cliSessions.some((s) => s.id === id)
      );

      // Add any new CLI sessions not yet in splitPanes
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
    this.pushNav(project.activeSessionId);
    this.persist();
    this.emit('session-changed');
  }

  gotoSession(index: number): void {
    const project = this.activeProject;
    if (!project || index >= project.sessions.length) return;
    project.activeSessionId = project.sessions[index].id;
    this.pushNav(project.activeSessionId);
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

  reorderProject(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= this.state.projects.length) return;
    if (toIndex < 0 || toIndex >= this.state.projects.length) return;
    const [project] = this.state.projects.splice(fromIndex, 1);
    this.state.projects.splice(toIndex, 0, project);
    this.persist();
    this.emit('project-changed');
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

export function createDefaultBoard(): BoardData {
  const columns: BoardColumn[] = [
    { id: crypto.randomUUID(), title: 'Backlog', order: 0, behavior: 'inbox' },
    { id: crypto.randomUUID(), title: 'Ready',   order: 1, behavior: 'none' },
    { id: crypto.randomUUID(), title: 'Running', order: 2, behavior: 'active' },
    { id: crypto.randomUUID(), title: 'Done',    order: 3, behavior: 'terminal' },
  ];
  return { columns, tasks: [] };
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  (appState as any)['state'] = { version: 1, projects: [], activeProjectId: null, preferences: { ...defaultPreferences } };
  (appState as any)['listeners'] = new Map();
  (appState as any)['nav'] = new NavHistory();
}

export const appState = new AppState();
