import { appState } from './state.js';
import { onChange as onStatusChange } from './session-activity.js';
import type { GitWorktree, SessionRecord } from './types.js';

export interface GitStatus {
  isGitRepo: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
}

type GitStatusCallback = (projectId: string, status: GitStatus) => void;
type WorktreeChangeCallback = () => void;

const cache = new Map<string, GitStatus>();
const listeners: GitStatusCallback[] = [];
const worktreeChangeListeners: WorktreeChangeCallback[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
/** When true, run another poll as soon as the current one finishes (coalesced). */
let pollPending = false;

// Worktree cache: projectId → GitWorktree[]
const worktreeCache = new Map<string, GitWorktree[]>();
// Session → worktree path mapping (from shell cwd; used when gitWorktreePath is unset)
const sessionWorktreeMap = new Map<string, string>();
/** Last PTY cwd per session (in-memory; Windows may not report cwd). */
const sessionShellCwd = new Map<string, string>();
/** Last git root we polled per project — used to re-notify UI when the path changes but counts match. */
const lastPolledGitPathByProject = new Map<string, string>();

/** Terminal-style tabs (unset `type`) can pin a git worktree per tab. */
export function sessionSupportsGitWorktreePin(session: SessionRecord | undefined): boolean {
  return session != null && !session.type;
}
let unwatchGitChanged: (() => void) | null = null;

/** Compare worktree roots across Windows/Linux and trailing slash differences. */
function normWorktreePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

async function refreshWorktrees(projectId: string, projectPath: string): Promise<void> {
  try {
    const worktrees = await window.vibeyard.git.getWorktrees(projectPath) as GitWorktree[];
    const prev = worktreeCache.get(projectId);
    worktreeCache.set(projectId, worktrees);

    // Empty list usually means git failed — do not prune persisted pins (would wipe all worktree tabs).
    if (worktrees.length > 0) {
      appState.pruneStaleSessionGitWorktrees(projectId, new Set(worktrees.map((w) => w.path)));
    }

    if (!prev || JSON.stringify(prev) !== JSON.stringify(worktrees)) {
      for (const cb of worktreeChangeListeners) cb();
    }
  } catch {
    // Ignore errors
  }
}

async function detectSessionWorktree(sessionId: string): Promise<void> {
  const project = appState.activeProject;
  if (!project) return;

  const session = project.sessions.find((s) => s.id === sessionId);
  if (!session || !sessionSupportsGitWorktreePin(session)) return;

  let cwd: string | null = null;
  try {
    cwd = await window.vibeyard.pty.getCwd(sessionId);
  } catch {
    // Ignore errors
  }

  const nextShell = cwd?.trim() ?? '';
  const prevShell = sessionShellCwd.get(sessionId) ?? '';
  let shellChanged = false;
  if (prevShell !== nextShell) {
    if (nextShell) sessionShellCwd.set(sessionId, nextShell);
    else sessionShellCwd.delete(sessionId);
    shellChanged = true;
  }

  if (session.gitWorktreeUserPinned) {
    if (shellChanged) {
      for (const cb of worktreeChangeListeners) cb();
    }
    return;
  }

  const worktrees = worktreeCache.get(project.id);
  if (!worktrees || worktrees.length <= 1) {
    if (shellChanged) {
      for (const cb of worktreeChangeListeners) cb();
    }
    return;
  }

  let bestMatch = '';
  if (nextShell) {
    const shellN = normWorktreePath(nextShell);
    for (const wt of worktrees) {
      if (wt.isBare) continue;
      const wtN = normWorktreePath(wt.path);
      const under = shellN === wtN || shellN.startsWith(wtN + '/');
      if (under && wtN.length > normWorktreePath(bestMatch).length) {
        bestMatch = wt.path;
      }
    }
  }

  const prevMap = sessionWorktreeMap.get(sessionId) ?? '';
  let mapChanged = false;
  if (bestMatch) {
    sessionWorktreeMap.set(sessionId, bestMatch);
    if (prevMap !== bestMatch) mapChanged = true;
  } else {
    sessionWorktreeMap.delete(sessionId);
    if (prevMap !== '') mapChanged = true;
  }

  const prevPersisted = session.gitWorktreePath ?? '';
  if (bestMatch) {
    if (normWorktreePath(bestMatch) !== normWorktreePath(prevPersisted)) {
      appState.syncSessionGitWorktreeFromDetect(project.id, sessionId, bestMatch);
    }
  } else if (prevPersisted !== '' && nextShell !== '') {
    // PTY cwd unknown (session not spawned yet): keep restored gitWorktreePath until we can see cwd.
    appState.syncSessionGitWorktreeFromDetect(project.id, sessionId, null);
  }

  if (shellChanged || mapChanged) {
    for (const cb of worktreeChangeListeners) cb();
  }
}

async function poll(): Promise<void> {
  const project = appState.activeProject;
  if (!project) return;

  if (polling) {
    pollPending = true;
    return;
  }

  polling = true;
  try {
    for (;;) {
      await refreshWorktrees(project.id, project.path);

      const activeSession = appState.activeSession;
      if (activeSession && sessionSupportsGitWorktreePin(activeSession)) {
        await detectSessionWorktree(activeSession.id);
      }

      const gitPath = getActiveGitPath(project.id);
      const status = await window.vibeyard.git.getStatus(gitPath) as GitStatus;
      const cacheKey = `${project.id}:${gitPath}`;
      const prev = cache.get(cacheKey);
      cache.set(cacheKey, status);

      const prevPath = lastPolledGitPathByProject.get(project.id);
      const pathChanged = prevPath !== gitPath;
      lastPolledGitPathByProject.set(project.id, gitPath);

      if (!prev || JSON.stringify(prev) !== JSON.stringify(status) || pathChanged) {
        for (const cb of listeners) cb(project.id, status);
      }

      if (!pollPending) break;
      pollPending = false;
    }
  } catch {
    // Ignore errors
  } finally {
    polling = false;
    pollPending = false;
  }
}

export function getGitStatus(projectId: string): GitStatus | null {
  const gitPath = getActiveGitPath(projectId);
  const key = `${projectId}:${gitPath}`;
  return cache.get(key) ?? null;
}

export function getWorktrees(projectId: string): GitWorktree[] | null {
  return worktreeCache.get(projectId) ?? null;
}

export function getActiveGitPath(projectId: string): string {
  const project = appState.projects.find((p) => p.id === projectId);
  if (!project?.activeSessionId) return project?.path ?? '';

  const session = project.sessions.find((s) => s.id === project.activeSessionId);
  const worktrees = worktreeCache.get(project.id);
  const path = session?.gitWorktreePath;

  if (session?.gitWorktreeUserPinned && path) {
    if (!worktrees || worktrees.length === 0) {
      return path;
    }
    const known = worktrees.some((w) => w.path === path && !w.isBare);
    if (known) return path;
  }

  if (path) {
    if (!worktrees || worktrees.length === 0) {
      return path;
    }
    const known = worktrees.some((w) => w.path === path && !w.isBare);
    if (known) return path;
  }

  const sessionWt = sessionWorktreeMap.get(project.activeSessionId);
  if (sessionWt) return sessionWt;

  return project.path;
}

export function getSessionWorktree(sessionId: string): string | null {
  const project = appState.activeProject;
  const session = project?.sessions.find((s) => s.id === sessionId);
  if (session?.gitWorktreePath) {
    return session.gitWorktreePath;
  }
  return sessionWorktreeMap.get(sessionId) ?? null;
}

export function getSessionShellCwd(sessionId: string): string | null {
  const v = sessionShellCwd.get(sessionId);
  return v ?? null;
}

/** Set git worktree for the active terminal tab only (sidebar selector). */
export function setActiveWorktree(projectId: string, path: string | null): void {
  const project = appState.projects.find((p) => p.id === projectId);
  if (!project?.activeSessionId) return;
  const pin = path != null && path !== '';
  appState.setSessionGitWorktree(projectId, project.activeSessionId, path, { userPinned: pin });
  void refreshGitStatus();
}

export { poll as refreshGitStatus };

export function onChange(callback: GitStatusCallback): void {
  listeners.push(callback);
}

export function onWorktreeChange(callback: WorktreeChangeCallback): void {
  worktreeChangeListeners.push(callback);
}

function startInterval(): void {
  if (pollTimer) return; // Already polling
  if (document.hidden || !appState.activeProject) return; // No reason to poll
  poll();
  pollTimer = setInterval(poll, 60_000);
}

function stopInterval(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export function startPolling(): void {
  startInterval();

  // Subscribe to main-process file system watcher push events (once)
  if (!unwatchGitChanged) {
    unwatchGitChanged = window.vibeyard.git.onChanged(() => poll());
  }

  // Start watcher for current project
  if (appState.activeProject) {
    window.vibeyard.git.watchProject(appState.activeProject.path);
  }

  // Pause/resume when window visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopInterval();
    } else {
      startInterval();
    }
  });

  // Immediate poll on project/session changes; manage interval lifecycle
  appState.on('project-changed', () => {
    if (!appState.activeProject) {
      stopInterval();
    } else {
      window.vibeyard.git.watchProject(appState.activeProject.path);
      startInterval();
    }
  });

  // `startPolling()` runs before `appState.load()` in index.ts; initial state has no project,
  // so the first `startInterval()` no-ops. Persisted projects only fire `state-loaded`, not
  // `project-changed` — without this, git never polls and the branch menu stays dead.
  appState.on('state-loaded', () => {
    if (appState.activeProject) {
      window.vibeyard.git.watchProject(appState.activeProject.path);
    }
    startInterval();
  });

  appState.on('session-added', () => poll());

  // Detect worktree on session change
  appState.on('session-changed', () => {
    void poll();
    for (const cb of worktreeChangeListeners) cb();
  });

  // Poll when a session transitions from working → waiting/completed
  onStatusChange((_sessionId, status) => {
    if (status === 'waiting' || status === 'completed') {
      void (async () => {
        const session = appState.activeProject?.sessions.find((s) => s.id === _sessionId);
        if (session && sessionSupportsGitWorktreePin(session)) {
          await detectSessionWorktree(_sessionId);
        }
        await poll();
      })();
    }
  });
}

export function stopPolling(): void {
  stopInterval();
}
