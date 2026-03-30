import type { ToolFailureData } from '../../shared/types.js';
import { appState } from '../state.js';

export interface LargeFileAlert {
  sessionId: string;
  projectId: string;
  filePath: string;
}

type LargeFileAlertCallback = (alert: LargeFileAlert) => void;

const TOKEN_LIMIT_RE = /file content \(\d+ tokens\) exceeds maximum allowed tokens/i;

const alertedPerSession = new Map<string, Set<string>>();
const alertListeners: LargeFileAlertCallback[] = [];

export function onLargeFileAlert(callback: LargeFileAlertCallback): void {
  alertListeners.push(callback);
}

export function handleToolFailure(sessionId: string, data: ToolFailureData): void {
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

  const insightId = `large-file-read:${filePath}`;
  if (appState.isInsightDismissed(project.id, insightId)) return;

  alerted.add(filePath);

  for (const cb of alertListeners) cb({ sessionId, projectId: project.id, filePath });
}

export function initLargeFileDetector(): void {
  window.vibeyard.session.onToolFailure((sessionId, data) => {
    handleToolFailure(sessionId, data);
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
}
