import { onToolAlert, type ToolAlert, type FailureReason } from '../tools/missing-tool-detector.js';
import { dismissInsight } from '../session-insights.js';
import { appState } from '../state.js';
import { showAlertBanner, removeAlertBanner } from './alert-banner.js';
import { setPendingPrompt } from './terminal-pane.js';

export function initToolAlert(): void {
  onToolAlert((alert) => {
    if (appState.activeSession?.id !== alert.sessionId) return;
    requestAnimationFrame(() => showToolBanner(alert));
  });
}

type AlertableReason = Exclude<FailureReason, 'other'>;

interface ReasonConfig {
  icon: string;
  message: (name: string, cmd: string, desc: string) => string;
  prompt: (name: string, cmd: string, desc: string) => string;
}

const bannerConfig: Record<AlertableReason, ReasonConfig> = {
  'not-found': {
    icon: '\u2139',
    message: (name, cmd, desc) => `"${name}" (${cmd}) is not installed. Install it for ${desc}.`,
    prompt: (name, cmd) => `The CLI tool "${name}" (${cmd}) is not installed on this system. Please install it and verify the installation works.`,
  },
  'permission-denied': {
    icon: '\u26A0',
    message: (name, cmd) => `"${name}" (${cmd}) cannot execute \u2014 permission denied.`,
    prompt: (name, cmd) => `The CLI tool "${name}" (${cmd}) exists but has a permission issue. Please check file permissions (e.g., chmod +x) and verify it can execute.`,
  },
  'auth-required': {
    icon: '\uD83D\uDD12',
    message: (name, cmd) => `"${name}" (${cmd}) requires authentication setup.`,
    prompt: (name, cmd) => `The CLI tool "${name}" (${cmd}) is installed but requires authentication. Please set up authentication/login and verify it works.`,
  },
};

function handleFixAction(alert: ToolAlert): void {
  const project = appState.activeProject;
  if (!project) return;

  const config = bannerConfig[alert.reason as AlertableReason];
  const prompt = config.prompt(alert.tool.name, alert.tool.command, alert.tool.description);

  const session = appState.addSession(project.id, `Fix ${alert.tool.name}`);
  if (!session) return;

  removeAlertBanner();

  setPendingPrompt(session.id, prompt);
}

function showToolBanner(alert: ToolAlert): void {
  const insightId = `tool-issue:${alert.tool.command}:${alert.reason}`;
  const config = bannerConfig[alert.reason as AlertableReason];

  showAlertBanner({
    className: 'insight-alert-info',
    icon: config.icon,
    message: config.message(alert.tool.name, alert.tool.command, alert.tool.description),
    cta: {
      label: 'Fix in New Session',
      onClick: () => handleFixAction(alert),
    },
    onDismiss: () => dismissInsight(alert.projectId, insightId),
  });
}
