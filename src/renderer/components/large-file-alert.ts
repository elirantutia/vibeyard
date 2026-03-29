import { onLargeFileAlert, type LargeFileAlert } from '../tools/large-file-detector.js';
import { dismissInsight } from '../session-insights.js';
import { appState } from '../state.js';
import { showAlertBanner, removeAlertBanner } from './alert-banner.js';

let pendingActionTimer: ReturnType<typeof setTimeout> | null = null;

export function initLargeFileAlert(): void {
  onLargeFileAlert((alert) => {
    if (appState.activeSession?.id !== alert.sessionId) return;
    requestAnimationFrame(() => showLargeFileBanner(alert));
  });

  appState.on('session-removed', () => {
    clearPendingAction();
  });

  appState.on('session-changed', () => {
    clearPendingAction();
  });
}

function clearPendingAction(): void {
  if (pendingActionTimer !== null) {
    clearTimeout(pendingActionTimer);
    pendingActionTimer = null;
  }
}

function getFilename(filePath: string): string {
  return filePath.split('/').pop() || filePath;
}

function handleSplitAction(alert: LargeFileAlert): void {
  const project = appState.activeProject;
  if (!project) return;

  const filename = getFilename(alert.filePath);
  const prompt = `The file ${alert.filePath} is too large and exceeds the AI context read limit. Please analyze it and split it into smaller, focused modules. Preserve all existing functionality.`;

  const session = appState.addSession(project.id, `Split ${filename}`);
  if (!session) return;

  removeAlertBanner();

  clearPendingAction();
  pendingActionTimer = setTimeout(() => {
    pendingActionTimer = null;
    window.vibeyard.pty.write(session.id, prompt + '\r');
  }, 2000);
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
