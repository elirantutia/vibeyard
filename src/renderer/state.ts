import type { ClaudeIdeApi } from './types.js';

declare global {
  interface Window {
    claudeIde: ClaudeIdeApi;
  }
}

export interface SessionRecord {
  id: string;
  name: string;
  type?: 'claude' | 'mcp-inspector';
  args?: string;
  claudeSessionId: string | null;
  mcpServerUrl?: string;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  sessions: SessionRecord[];
  activeSessionId: string | null;
  layout: {
    mode: 'tabs' | 'split';
    splitPanes: string[];
    splitDirection: 'horizontal' | 'vertical';
  };
  terminalPanelOpen?: boolean;
  terminalPanelHeight?: number;
}

export interface Preferences {
  soundOnSessionWaiting: boolean;
  debugMode: boolean;
  keybindings?: Record<string, string>;
}

export interface PersistedState {
  version: 1;
  projects: ProjectRecord[];
  activeProjectId: string | null;
  preferences: Preferences;
  sidebarWidth?: number;
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
  | 'state-loaded';

type EventCallback = (data?: unknown) => void;

const defaultPreferences: Preferences = { soundOnSessionWaiting: false, debugMode: false };

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
    const loaded = (await window.claudeIde.store.load()) as PersistedState | null;
    if (loaded && loaded.version === 1) {
      this.state = loaded;
      // Merge defaults for forward compatibility with old state files
      this.state.preferences = { ...defaultPreferences, ...this.state.preferences };
    }
    this.emit('state-loaded');
  }

  private persist(): void {
    window.claudeIde.store.save(this.state);
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
      layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
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

    const session: SessionRecord = {
      id: crypto.randomUUID(),
      name,
      ...(args ? { args } : {}),
      claudeSessionId: null,
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
      claudeSessionId: null,
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

    project.sessions = project.sessions.filter((s) => s.id !== sessionId);
    if (project.activeSessionId === sessionId) {
      project.activeSessionId = project.sessions[0]?.id ?? null;
    }
    // Also remove from split panes
    project.layout.splitPanes = project.layout.splitPanes.filter((id) => id !== sessionId);
    this.persist();
    this.emit('session-removed', { projectId, sessionId });
    this.emit('session-changed');
  }

  setActiveSession(projectId: string, sessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    project.activeSessionId = sessionId;
    this.persist();
    this.emit('session-changed');
  }

  updateSessionClaudeId(projectId: string, sessionId: string, claudeSessionId: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const session = project.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    session.claudeSessionId = claudeSessionId;
    this.persist();
    this.emit('session-changed');
  }

  renameSession(projectId: string, sessionId: string, name: string): void {
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project) return;
    const session = project.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    session.name = name;
    this.persist();
    this.emit('session-changed');
  }

  toggleSplit(): void {
    const project = this.activeProject;
    if (!project) return;

    if (project.layout.mode === 'tabs') {
      project.layout.mode = 'split';
      // Add active session and next session to split panes
      const sessionIds = project.sessions.map((s) => s.id);
      project.layout.splitPanes = [];
      if (project.activeSessionId) {
        project.layout.splitPanes.push(project.activeSessionId);
      }
      const activeIdx = sessionIds.indexOf(project.activeSessionId ?? '');
      const nextIdx = (activeIdx + 1) % sessionIds.length;
      if (sessionIds[nextIdx] && !project.layout.splitPanes.includes(sessionIds[nextIdx])) {
        project.layout.splitPanes.push(sessionIds[nextIdx]);
      }
    } else {
      project.layout.mode = 'tabs';
      project.layout.splitPanes = [];
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

  reorderSession(projectId: string, sessionId: string, toIndex: number): void {
    const project = this.state.projects.find(p => p.id === projectId);
    if (!project) return;
    const fromIndex = project.sessions.findIndex(s => s.id === sessionId);
    if (fromIndex === -1 || fromIndex === toIndex) return;
    const [session] = project.sessions.splice(fromIndex, 1);
    project.sessions.splice(toIndex, 0, session);
    this.persist();
    this.emit('session-changed');
  }
}

export const appState = new AppState();
