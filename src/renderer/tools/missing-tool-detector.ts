import type { ToolFailureData } from '../../shared/types.js';
import type { ToolInfo } from './tool-catalog.js';
import { findTool } from './tool-catalog.js';
import { appState } from '../state.js';

export type FailureReason = 'not-found' | 'permission-denied' | 'auth-required' | 'other';

export interface ToolAlert {
  sessionId: string;
  projectId: string;
  tool: ToolInfo;
  reason: FailureReason;
}

type ToolAlertCallback = (alert: ToolAlert) => void;

const alertedPerSession = new Map<string, Set<string>>();
const alertListeners: ToolAlertCallback[] = [];

export function onToolAlert(callback: ToolAlertCallback): void {
  alertListeners.push(callback);
}

function extractCommand(cmd: string): string {
  const parts = cmd.trim().split(/\s+/);
  for (const part of parts) {
    if (part.includes('=') || part === 'sudo' || part === 'env') continue;
    return part;
  }
  return parts[0] || '';
}

const NOT_FOUND_RE = /command not found|:\s*not found(?!\s*\(HTTP\b)|status code 127|exit code 127/i;
const PERMISSION_DENIED_RE = /permission denied|status code 126|exit code 126/i;

export function classifyError(error: string, tool: ToolInfo): FailureReason {
  if (NOT_FOUND_RE.test(error)) return 'not-found';
  if (PERMISSION_DENIED_RE.test(error)) return 'permission-denied';
  if (tool.authPatterns && tool.authPatterns.length > 0) {
    const lower = error.toLowerCase();
    if (tool.authPatterns.some(p => lower.includes(p))) return 'auth-required';
  }
  return 'other';
}

export function handleToolFailure(sessionId: string, data: ToolFailureData): void {
  if (!appState.preferences.insightsEnabled) return;
  if (data.tool_name !== 'Bash') return;

  const command = typeof data.tool_input?.command === 'string'
    ? extractCommand(data.tool_input.command)
    : '';
  if (!command) return;

  const tool = findTool(command);
  if (!tool) return;

  const reason = classifyError(data.error, tool);
  if (reason === 'other') return;

  const dedupKey = `${command}:${reason}`;
  let alerted = alertedPerSession.get(sessionId);
  if (!alerted) {
    alerted = new Set();
    alertedPerSession.set(sessionId, alerted);
  }
  if (alerted.has(dedupKey)) return;

  const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
  if (!project) return;

  const insightId = `tool-issue:${command}:${reason}`;
  const legacyId = `missing-tool:${command}`;
  if (appState.isInsightDismissed(project.id, insightId) || appState.isInsightDismissed(project.id, legacyId)) return;

  alerted.add(dedupKey);

  for (const cb of alertListeners) cb({ sessionId, projectId: project.id, tool, reason });
}

export function initToolDetector(): void {
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
