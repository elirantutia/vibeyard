import picomatch from 'picomatch';
import type { ToolFailureData } from '../../shared/types.js';
import { DEFAULT_SCAN_IGNORE, EXCLUDED_DIRECTORIES, EXTRA_ALERT_IGNORE } from '../../shared/constants.js';
import { basename as pathBasename } from '../../shared/platform.js';
import { appState } from '../state.js';

export interface LargeFileAlert {
  sessionId: string;
  projectId: string;
  filePath: string;
}

type LargeFileAlertCallback = (alert: LargeFileAlert) => void;

const TOKEN_LIMIT_RE = /file content \(\d+ tokens\) exceeds maximum allowed tokens/i;

const excludedDirSet = new Set(EXCLUDED_DIRECTORIES);
const hardcodedMatcher = picomatch([...DEFAULT_SCAN_IGNORE, ...EXTRA_ALERT_IGNORE], { basename: true });

function getRelativePath(filePath: string, projectPath: string): string | null {
  const base = projectPath.endsWith('/') ? projectPath : projectPath + '/';
  if (!filePath.startsWith(base)) return null;
  return filePath.slice(base.length);
}

function isExcludedPath(relative: string): boolean {
  if (relative === '.claude' || relative.startsWith('.claude/')) return true;
  const segments = relative.split('/');
  for (let i = 0; i < segments.length - 1; i++) {
    if (excludedDirSet.has(segments[i])) return true;
  }
  const basename = segments[segments.length - 1];
  if (hardcodedMatcher(basename) || hardcodedMatcher(relative)) return true;
  return false;
}

type IgnoreMatchers = { basename: picomatch.Matcher; fullPath: picomatch.Matcher };
const ignoreMatcherCache = new Map<string, IgnoreMatchers | null>();

async function loadVibeyardignore(projectPath: string): Promise<IgnoreMatchers | null> {
  try {
    const result = await window.vibeyard.fs.readFile(projectPath + '/.vibeyardignore');
    if (!result.ok) return null;
    const patterns: string[] = [];
    for (const raw of result.content.split('\n')) {
      const line = raw.trim();
      if (line && !line.startsWith('#')) patterns.push(line);
    }
    if (patterns.length === 0) return null;
    return {
      basename: picomatch(patterns, { basename: true }),
      fullPath: picomatch(patterns),
    };
  } catch {
    return null;
  }
}

async function matchesVibeyardignore(projectPath: string, relative: string): Promise<boolean> {
  if (!ignoreMatcherCache.has(projectPath)) {
    ignoreMatcherCache.set(projectPath, await loadVibeyardignore(projectPath));
  }
  const matchers = ignoreMatcherCache.get(projectPath);
  if (!matchers) return false;
  const base = pathBasename(relative);
  return matchers.basename(base) || matchers.fullPath(relative);
}

const alertedPerSession = new Map<string, Set<string>>();
const alertListeners: LargeFileAlertCallback[] = [];

export function onLargeFileAlert(callback: LargeFileAlertCallback): void {
  alertListeners.push(callback);
}

export async function handleToolFailure(sessionId: string, data: ToolFailureData): Promise<void> {
  if (!appState.preferences.insightsEnabled) return;
  if (data.tool_name !== 'Read') return;
  if (!TOKEN_LIMIT_RE.test(data.error)) return;

  const filePath = typeof data.tool_input?.file_path === 'string'
    ? data.tool_input.file_path
    : '';
  if (!filePath) return;

  let alerted = alertedPerSession.get(sessionId);
  if (!alerted) {
    alerted = new Set();
    alertedPerSession.set(sessionId, alerted);
  }
  if (alerted.has(filePath)) return;

  const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
  if (!project) return;

  const relative = getRelativePath(filePath, project.path);
  if (!relative) return;

  if (isExcludedPath(relative)) return;

  const insightId = `large-file-read:${filePath}`;
  if (appState.isInsightDismissed(project.id, insightId)) return;

  if (await matchesVibeyardignore(project.path, relative)) return;

  alerted.add(filePath);

  for (const cb of alertListeners) cb({ sessionId, projectId: project.id, filePath });
}

export function initLargeFileDetector(): void {
  window.vibeyard.session.onToolFailure((sessionId, data) => {
    handleToolFailure(sessionId, data).catch(() => {});
  });

  appState.on('session-removed', (data?: unknown) => {
    const d = data as { sessionId?: string } | undefined;
    if (d?.sessionId) {
      alertedPerSession.delete(d.sessionId);
    }
  });
}

/** @internal */
export function _resetForTesting(): void {
  alertedPerSession.clear();
  alertListeners.length = 0;
  ignoreMatcherCache.clear();
}
