import { onAlert, dismissInsight } from '../session-insights.js';
import { appState } from '../state.js';
import type { InsightResult } from '../insights/types.js';
import { showAlertBanner, removeAlertBanner } from './alert-banner.js';
import { setPendingPrompt } from './terminal-pane.js';

export function initInsightAlert(): void {
  onAlert((projectId, results) => {
    const result = results[0];
    if (!result) return;
    requestAnimationFrame(() => showInsightBanner(projectId, result));
  });
}

function handleInsightAction(result: InsightResult): void {
  if (!result.action) return;

  const project = appState.activeProject;
  if (!project) return;

  const session = appState.addSession(project.id, 'Fix Pre-Context');
  if (!session) return;

  removeAlertBanner();

  setPendingPrompt(session.id, result.action.prompt);
}

function showInsightBanner(projectId: string, result: InsightResult): void {
  showAlertBanner({
    icon: '\u26A0',
    message: result.description,
    cta: result.action ? {
      label: result.action.label,
      onClick: () => handleInsightAction(result),
    } : undefined,
    onDismiss: () => dismissInsight(projectId, result.id),
  });
}
