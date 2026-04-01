import { onLargeFileAlert, type LargeFileAlert } from '../tools/large-file-detector.js';
import { dismissInsight } from '../session-insights.js';
import { appState } from '../state.js';
import { showAlertBanner, removeAlertBanner } from './alert-banner.js';
import { setPendingPrompt } from './terminal-pane.js';

export function initLargeFileAlert(): void {
  onLargeFileAlert((alert) => {
    if (appState.activeSession?.id !== alert.sessionId) return;
    requestAnimationFrame(() => showLargeFileBanner(alert));
  });
}

function getFilename(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

function handleSplitAction(alert: LargeFileAlert): void {
  const project = appState.activeProject;
  if (!project) return;

  const filename = getFilename(alert.filePath);
  const prompt = `The file ${alert.filePath} is too large and exceeds the AI context read limit. Please analyze it and split it into smaller, focused modules. Preserve all existing functionality.`;

  const session = appState.addPlanSession(project.id, `Split ${filename}`);
  if (!session) return;

  removeAlertBanner();

  setPendingPrompt(session.id, prompt);
}

function showLargeFileBanner(alert: LargeFileAlert): void {
  const insightId = `large-file-read:${alert.filePath}`;
  const filename = getFilename(alert.filePath);

  showAlertBanner({
    className: 'insight-alert-info',
    icon: '\u26A0',
    message: `"${filename}" is too large for AI to read in one pass. Consider splitting it into smaller, focused modules.`,
    cta: {
      label: 'Split in New Session',
      onClick: () => handleSplitAction(alert),
    },
    onDismiss: () => dismissInsight(alert.projectId, insightId),
  });
}
