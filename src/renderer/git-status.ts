import { appState } from './state.js';
import { onChange as onStatusChange } from './session-activity.js';
import type { GitWorktree } from './types.js';

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

// Worktree cache: projectId → GitWorktree[]
const worktreeCache = new Map<string, GitWorktree[]>();
// Session → worktree path mapping
const sessionWorktreeMap = new Map<string, string>();
// Manual override: projectId → worktree path
const manualOverride = new Map<string, string>();
let worktreePollCounter = 0;
let unwatchGitChanged: (() => void) | null = null;

async function refreshWorktrees(projectId: string, projectPath: string): Promise<void> {
  try {
    const worktrees = await window.vibeyard.git.getWorktrees(projectPath) as GitWorktree[];
    const prev = worktreeCache.get(projectId);
    worktreeCache.set(projectId, worktrees);

    // Clean up manual overrides pointing to deleted worktrees
    const override = manualOverride.get(projectId);
    if (override && !worktrees.some(w => w.path === override)) {
      manualOverride.delete(projectId);
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

  try {
    const cwd = await window.vibeyard.pty.getCwd(sessionId);
    if (!cwd) return;

    const worktrees = worktreeCache.get(project.id);
    if (!worktrees || worktrees.length <= 1) return;

    // Find which worktree the cwd falls under (longest path match)
    let bestMatch = '';
    for (const wt of worktrees) {
      if ((cwd === wt.path || cwd.startsWith(wt.path + '/')) && wt.path.length > bestMatch.length) {
        bestMatch = wt.path;
      }
    }

    if (bestMatch) {
      const prev = sessionWorktreeMap.get(sessionId);
      sessionWorktreeMap.set(sessionId, bestMatch);
      if (prev !== bestMatch) {
        for (const cb of worktreeChangeListeners) cb();
      }
    }
  } catch {
    // Ignore errors
  }
}

async function poll(): Promise<void> {
  const project = appState.activeProject;
  if (!project || polling) return;

  polling = true;
  try {
    // Refresh worktree list every 3rd poll (~30s)
    worktreePollCounter++;
    if (worktreePollCounter % 3 === 1) {
      await refreshWorktrees(project.id, project.path);
    }

    // Detect active session's worktree
    const activeSession = appState.activeSession;
    if (activeSession && activeSession.type !== 'diff-viewer' && activeSession.type !== 'file-reader' && activeSession.type !== 'mcp-inspector') {
      await detectSessionWorktree(activeSession.id);
    }

    // Query git status using the resolved worktree path
    const gitPath = getActiveGitPath(project.id);
    const status = await window.vibeyard.git.getStatus(gitPath) as GitStatus;
    const cacheKey = `${project.id}:${gitPath}`;
    const prev = cache.get(cacheKey);
    cache.set(cacheKey, status);
    // Also set by projectId for backward compatibility
    cache.set(project.id, status);

    if (!prev || JSON.stringify(prev) !== JSON.stringify(status)) {
      for (const cb of listeners) cb(project.id, status);
    }
  } catch {
    // Ignore errors
  } finally {
    polling = false;
  }
}

export function getGitStatus(projectId: string): GitStatus | null {
  return cache.get(projectId) ?? null;
}

export function getWorktrees(projectId: string): GitWorktree[] | null {
  return worktreeCache.get(projectId) ?? null;
}

export function getActiveGitPath(projectId: string): string {
  // Manual override takes precedence
  const override = manualOverride.get(projectId);
  if (override) return override;

  // Check active session's worktree
  const project = appState.projects.find(p => p.id === projectId);
  if (project?.activeSessionId) {
    const sessionWt = sessionWorktreeMap.get(project.activeSessionId);
    if (sessionWt) return sessionWt;
  }

  // Fallback to project path
  return project?.path ?? '';
}

export function getSessionWorktree(sessionId: string): string | null {
  return sessionWorktreeMap.get(sessionId) ?? null;
}

export function setActiveWorktree(projectId: string, path: string | null): void {
  if (path) {
    manualOverride.set(projectId, path);
  } else {
    manualOverride.delete(projectId);
  }
  // Trigger refresh
  poll();
  for (const cb of worktreeChangeListeners) cb();
}

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
    worktreePollCounter = 0; // Force worktree refresh on project switch
    if (!appState.activeProject) {
      stopInterval();
    } else {
      window.vibeyard.git.watchProject(appState.activeProject.path);
      startInterval();
    }
  });
  appState.on('session-added', () => poll());

  // Detect worktree on session change
  appState.on('session-changed', () => {
    const activeSession = appState.activeSession;
    if (activeSession && activeSession.type !== 'diff-viewer' && activeSession.type !== 'file-reader' && activeSession.type !== 'mcp-inspector') {
      detectSessionWorktree(activeSession.id);
    }
    // Clear manual override on session switch so auto-detection takes effect
    const project = appState.activeProject;
    if (project) {
      manualOverride.delete(project.id);
    }
    poll();
  });

  // Poll when a session transitions from working → waiting/completed
  onStatusChange((_sessionId, status) => {
    if (status === 'waiting' || status === 'completed') {
      // Also re-detect worktree on status transition
      detectSessionWorktree(_sessionId);
      poll();
    }
  });
}

export function stopPolling(): void {
  stopInterval();
}
