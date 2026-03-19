import { appState } from './state.js';
import { promptNewProject } from './components/sidebar.js';
import { quickNewSession } from './components/tab-bar.js';
import { toggleProjectTerminal } from './components/project-terminal.js';
import { toggleDebugPanel } from './components/debug-panel.js';
import { showHelpDialog } from './components/help-dialog.js';
import { getFocusedSessionId } from './components/terminal-pane.js';
import { showSearchBar } from './components/search-bar.js';
import { toggleGitPanel } from './components/git-panel.js';
import { shortcutManager } from './shortcuts.js';

export function initKeybindings(): void {
  // Menu-based shortcuts (registered via Electron menu accelerators)
  // These handlers receive events forwarded from the main process menu
  window.claudeIde.menu.onNewProject(() => promptNewProject());
  window.claudeIde.menu.onNewSession(() => quickNewSession());
  window.claudeIde.menu.onToggleSplit(() => appState.toggleSplit());
  window.claudeIde.menu.onNextSession(() => appState.cycleSession(1));
  window.claudeIde.menu.onPrevSession(() => appState.cycleSession(-1));
  window.claudeIde.menu.onGotoSession((index) => appState.gotoSession(index));
  window.claudeIde.menu.onToggleDebug(() => toggleDebugPanel());

  // Register shortcut handlers
  shortcutManager.registerHandler('new-session', () => quickNewSession());
  shortcutManager.registerHandler('new-session-alt', () => quickNewSession());
  shortcutManager.registerHandler('new-project', () => promptNewProject());
  for (let i = 1; i <= 9; i++) {
    shortcutManager.registerHandler(`goto-session-${i}`, () => appState.gotoSession(i - 1));
  }
  shortcutManager.registerHandler('next-session', () => appState.cycleSession(1));
  shortcutManager.registerHandler('prev-session', () => appState.cycleSession(-1));
  shortcutManager.registerHandler('toggle-split', () => appState.toggleSplit());
  shortcutManager.registerHandler('project-terminal', () => toggleProjectTerminal());
  shortcutManager.registerHandler('debug-panel', () => toggleDebugPanel());
  shortcutManager.registerHandler('git-panel', () => toggleGitPanel());
  shortcutManager.registerHandler('find-in-terminal', () => {
    const sessionId = getFocusedSessionId();
    if (sessionId) showSearchBar(sessionId);
  });
  shortcutManager.registerHandler('help', () => showHelpDialog());

  document.addEventListener('keydown', (e) => {
    shortcutManager.matchEvent(e);
  });
}
