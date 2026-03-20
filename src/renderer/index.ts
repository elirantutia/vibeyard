import { appState } from './state.js';
import { initSidebar } from './components/sidebar.js';
import { initTabBar } from './components/tab-bar.js';
import { initSplitLayout } from './components/split-layout.js';
import { initKeybindings } from './keybindings.js';
import { handlePtyData, destroyTerminal, updateCostDisplay, updateContextDisplay } from './components/terminal-pane.js';
import { setIdle, setHookStatus, notifyPtyData } from './session-activity.js';
import { parseCost, setCostData, onChange as onCostChange } from './session-cost.js';
import { setContextData, onChange as onContextChange } from './session-context.js';
import { initConfigSections } from './components/config-sections.js';
import { initNotificationSound } from './notification-sound.js';
import { init as initSessionUnread } from './session-unread.js';
import { initProjectTerminal, handleShellPtyData, handleShellPtyExit, isShellSessionId } from './components/project-terminal.js';
import { startPolling as startGitPolling } from './git-status.js';
import { initDebugPanel, logDebugEvent, setDebugVisible } from './components/debug-panel.js';
import { initGitPanel } from './components/git-panel.js';
import { disconnectInspector } from './components/mcp-inspector.js';
import { initUpdateBanner } from './components/update-banner.js';
import { initSessionHistory } from './components/session-history.js';
import { showUsageModal } from './components/usage-modal.js';

let isQuitting = false;
window.claudeIde.app.onQuitting(() => { isQuitting = true; });

async function main(): Promise<void> {
  // Wire PTY data/exit events from main process
  window.claudeIde.pty.onData((sessionId, data) => {
    logDebugEvent('ptyData', sessionId, data.slice(0, 200));
    if (isShellSessionId(sessionId)) {
      handleShellPtyData(sessionId, data);
    } else if (!isMcpSession(sessionId)) {
      handlePtyData(sessionId, data);
      parseCost(sessionId, data);
      notifyPtyData(sessionId);
    }
  });

  window.claudeIde.session.onCostData((sessionId, costData) => {
    logDebugEvent('costData', sessionId, costData);
    setCostData(sessionId, costData);
    setContextData(sessionId, costData.context_window);
  });

  onCostChange((sessionId, cost) => {
    updateCostDisplay(sessionId, cost);
  });

  onContextChange((sessionId, info) => {
    updateContextDisplay(sessionId, info);
  });

  window.claudeIde.session.onHookStatus((sessionId, status) => {
    logDebugEvent('hookStatus', sessionId, status);
    setHookStatus(sessionId, status);
  });

  window.claudeIde.session.onCliSessionId((sessionId, cliSessionId) => {
    logDebugEvent('cliSessionId', sessionId, cliSessionId);
    // Find the project containing this session and persist the CLI session ID
    const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
    if (project) {
      appState.updateSessionCliId(project.id, sessionId, cliSessionId);
    }
  });

  window.claudeIde.pty.onExit((sessionId, exitCode) => {
    logDebugEvent('ptyExit', sessionId, { exitCode });
    if (isShellSessionId(sessionId)) {
      handleShellPtyExit(sessionId, exitCode);
    } else if (!isMcpSession(sessionId) && !isQuitting) {
      // Auto-close the session when CLI exits (skip during app quit to preserve session state)
      const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
      if (project) {
        destroyTerminal(sessionId);
        appState.removeSession(project.id, sessionId);
      }
    }
  });

  // Initialize components
  initSessionUnread();
  initSidebar();
  initTabBar();
  initSplitLayout();
  initKeybindings();
  initConfigSections();
  initNotificationSound();
  initProjectTerminal();
  initDebugPanel();
  initGitPanel();
  initSessionHistory();
  initUpdateBanner();
  startGitPolling();

  window.claudeIde.menu.onUsageStats(() => showUsageModal());
  document.getElementById('btn-usage-stats')!.addEventListener('click', () => showUsageModal());

  function isMcpSession(sessionId: string): boolean {
    for (const project of appState.projects) {
      const session = project.sessions.find(s => s.id === sessionId);
      if (session) return session.type === 'mcp-inspector';
    }
    return false;
  }

  // Log AppState events to debug panel
  const stateEvents = [
    'project-added', 'project-removed', 'project-changed',
    'session-added', 'session-removed', 'session-changed',
    'layout-changed', 'history-changed', 'state-loaded',
  ] as const;
  for (const evt of stateEvents) {
    appState.on(evt as Parameters<typeof appState.on>[0], (data) => {
      logDebugEvent('stateEvent', evt, data);
    });
  }

  // Load persisted state
  await appState.load();

  // Show debug panel if preference is enabled
  if (appState.preferences.debugMode) {
    setDebugVisible(true);
  }
}

main().catch(console.error);
