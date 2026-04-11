import { appState } from './state.js';
import { initSidebar, promptNewProject } from './components/sidebar.js';
import { initTabBar } from './components/tab-bar.js';
import { initSplitLayout } from './components/split-layout.js';
import { initKeybindings } from './keybindings.js';
import { handlePtyData, destroyTerminal, updateCostDisplay, updateContextDisplay } from './components/terminal-pane.js';
import { setIdle, setHookStatus, notifyInterrupt } from './session-activity.js';
import { parseCost, setCostData, onChange as onCostChange } from './session-cost.js';
import { parseTitle, clearSession as clearTitleSession } from './session-title.js';
import { setContextData, onChange as onContextChange } from './session-context.js';
import { initConfigSections } from './components/config-sections.js';
import { initNotificationSound } from './notification-sound.js';
import { initNotificationDesktop } from './notification-desktop.js';
import { init as initSessionUnread } from './session-unread.js';
import { initProjectTerminal, handleShellPtyData, handleShellPtyExit, isShellSessionId } from './components/project-terminal.js';
import { startPolling as startGitPolling } from './git-status.js';
import { initDebugPanel, logDebugEvent } from './components/debug-panel.js';
import { initGitPanel } from './components/git-panel.js';
import { disconnectInspector } from './components/mcp-inspector.js';
import { initUpdateBanner } from './components/update-banner.js';
import { initSessionHistory } from './components/session-history.js';
import { showUsageModal } from './components/usage-modal.js';
import { captureInitialContext } from './session-insights.js';
import { initInsightAlert } from './components/insight-alert.js';
import { initReadinessSection } from './components/readiness-section.js';
import { initToolDetector } from './tools/missing-tool-detector.js';
import { initToolAlert } from './components/tool-alert.js';
import { initLargeFileDetector } from './tools/large-file-detector.js';
import { initLargeFileAlert } from './components/large-file-alert.js';
import { initSettingsGuard } from './components/settings-guard-ui.js';
import { checkWhatsNew } from './components/whats-new-dialog.js';
import { initShareManager, forwardPtyData, endShare, cleanupAllShares } from './sharing/share-manager.js';
import { isSharing } from './sharing/peer-host.js';
import { checkStarPrompt } from './components/star-prompt-dialog.js';
import { addEvents as addInspectorEvents } from './session-inspector-state.js';
import type { InspectorEvent } from '../shared/types.js';
import { getContext } from './session-context.js';
import { initSessionInspector } from './components/session-inspector.js';
import { loadProviderMetas } from './provider-availability.js';
import { initCloseGuard } from './close-guard.js';

let isQuitting = false;
window.vibeyard.app.onQuitting(() => {
  isQuitting = true;
  cleanupAllShares();
});

async function main(): Promise<void> {
  // Wire PTY data/exit events from main process
  window.vibeyard.pty.onData((sessionId, data) => {
    if (isShellSessionId(sessionId)) {
      handleShellPtyData(sessionId, data);
    } else if (!isMcpSession(sessionId)) {
      handlePtyData(sessionId, data);
      parseCost(sessionId, data);
      parseTitle(sessionId, data);
      if (data.includes('Interrupted')) {
        notifyInterrupt(sessionId);
      }
      // Forward to P2P share if active
      if (isSharing(sessionId)) {
        forwardPtyData(sessionId, data);
      }
    }
  });

  window.vibeyard.session.onCostData((sessionId, costData) => {
    if (!appState.hasSession(sessionId)) return;
    logDebugEvent('costData', sessionId, costData);
    setCostData(sessionId, costData);
    const contextBefore = getContext(sessionId);
    setContextData(sessionId, costData.context_window);
    captureInitialContext(sessionId, costData.context_window);

    // Bridge cost/context into inspector events so Costs & Context tabs work.
    // Only emit when context actually changed (avoids filling the event buffer with duplicates).
    const contextAfter = getContext(sessionId);
    if (contextAfter && contextAfter !== contextBefore) {
      const syntheticEvent: InspectorEvent = {
        type: 'status_update',
        timestamp: Date.now(),
        hookEvent: 'StatusLine',
        cost_snapshot: {
          total_cost_usd: costData.cost.total_cost_usd ?? 0,
          total_duration_ms: costData.cost.total_duration_ms ?? 0,
        },
        context_snapshot: {
          total_tokens: contextAfter.totalTokens,
          context_window_size: contextAfter.contextWindowSize,
          used_percentage: contextAfter.usedPercentage,
        },
      };
      addInspectorEvents(sessionId, [syntheticEvent]);
    }
  });

  onCostChange((sessionId, cost) => {
    updateCostDisplay(sessionId, cost);
    appState.updateSessionCost(sessionId, cost);
  });

  onContextChange((sessionId, info) => {
    updateContextDisplay(sessionId, info);
    appState.updateSessionContext(sessionId, info);
  });

  window.vibeyard.session.onHookStatus((sessionId, status, hookName) => {
    if (!appState.hasSession(sessionId)) return;
    logDebugEvent('hookStatus', sessionId, hookName ? `${hookName}: ${status}` : status);
    setHookStatus(sessionId, status, hookName);
  });

  window.vibeyard.session.onInspectorEvents((sessionId, events) => {
    if (!appState.hasSession(sessionId)) return;
    logDebugEvent('inspectorEvents', sessionId, { count: events.length });
    addInspectorEvents(sessionId, events);
  });

  window.vibeyard.session.onCliSessionId((sessionId, cliSessionId) => {
    logDebugEvent('cliSessionId', sessionId, cliSessionId);
    // Find the project containing this session and persist the CLI session ID
    const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
    if (project) {
      clearTitleSession(sessionId);
      appState.updateSessionCliId(project.id, sessionId, cliSessionId);
    }
  });

  window.vibeyard.pty.onExit((sessionId, exitCode) => {
    logDebugEvent('ptyExit', sessionId, { exitCode });
    if (isShellSessionId(sessionId)) {
      handleShellPtyExit(sessionId, exitCode);
    } else if (!isMcpSession(sessionId) && !isQuitting) {
      // End any active P2P share for this session
      if (isSharing(sessionId)) {
        endShare(sessionId);
      }
      // Auto-close the session when CLI exits (skip during app quit to preserve session state)
      const project = appState.projects.find(p => p.sessions.some(s => s.id === sessionId));
      if (project) {
        destroyTerminal(sessionId);
        clearTitleSession(sessionId);
        appState.removeSession(project.id, sessionId);
      }
    }
  });

  // Load provider metadata before components so capabilities are available synchronously
  await loadProviderMetas();

  // Initialize components
  initSessionUnread();
  initSidebar();
  initTabBar();
  initSplitLayout();
  initKeybindings();
  initConfigSections();
  initNotificationSound();
  initNotificationDesktop();
  initProjectTerminal();
  initDebugPanel();
  initGitPanel();
  initSessionHistory();
  initUpdateBanner();
  initInsightAlert();
  initToolDetector();
  initToolAlert();
  initLargeFileDetector();
  initLargeFileAlert();
  initSettingsGuard();
  initReadinessSection();
  initShareManager();
  initSessionInspector();
  startGitPolling();

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
    'layout-changed', 'history-changed', 'insights-changed', 'state-loaded',
  ] as const;
  for (const evt of stateEvents) {
    appState.on(evt as Parameters<typeof appState.on>[0], (data) => {
      logDebugEvent('stateEvent', evt, data);
    });
  }

  // Load persisted state
  await appState.load();

  initCloseGuard();

  // Auto-open new project modal when no projects exist
  if (appState.projects.length === 0) {
    promptNewProject();
  }

  checkWhatsNew();
  checkStarPrompt();
}

main().catch(console.error);
