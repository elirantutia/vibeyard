import { appState } from './state.js';
import { promptNewProject, toggleSidebar } from './components/sidebar.js';
import { quickNewSession } from './components/tab-bar.js';
import { toggleProjectTerminal } from './components/project-terminal.js';
import { toggleDebugPanel } from './components/debug-panel.js';
import { showHelpDialog } from './components/help-dialog.js';
import { getFocusedSessionId } from './components/terminal-pane.js';
import { showSearchBar, TerminalSearchBackend, ShellTerminalSearchBackend } from './components/search-bar.js';
import { getActiveShellSessionId } from './components/project-terminal.js';
import { toggleGitPanel } from './components/git-panel.js';
import { showQuickOpen } from './components/quick-open.js';
import { shortcutManager } from './shortcuts.js';
import { stepUiAndTerminalZoom } from './display-preferences.js';
import { getFileReaderInstance, getFileReaderTextSelector, showGoToLineBar } from './components/file-reader.js';
import { getFileViewerInstance } from './components/file-viewer.js';
import { DomSearchBackend } from './components/dom-search-backend.js';
import { toggleInspector } from './components/session-inspector.js';

export function initKeybindings(): void {
  // Menu-based shortcuts (registered via Electron menu accelerators)
  // These handlers receive events forwarded from the main process menu
  window.vibeyard.menu.onNewProject(() => promptNewProject());
  window.vibeyard.menu.onNewSession(() => quickNewSession());
  window.vibeyard.menu.onToggleSplit(() => appState.toggleSwarm());
  window.vibeyard.menu.onNextSession(() => appState.cycleSession(1));
  window.vibeyard.menu.onPrevSession(() => appState.cycleSession(-1));
  window.vibeyard.menu.onGotoSession((index) => appState.gotoSession(index));
  window.vibeyard.menu.onToggleDebug(() => toggleDebugPanel());
  window.vibeyard.menu.onToggleInspector(() => toggleInspector());
  window.vibeyard.menu.onCloseSession(() => {
    const project = appState.activeProject;
    const session = appState.activeSession;
    if (project && session) appState.removeSession(project.id, session.id);
  });

  // Register shortcut handlers
  shortcutManager.registerHandler('new-session', () => quickNewSession());
  shortcutManager.registerHandler('new-session-alt', () => quickNewSession());
  shortcutManager.registerHandler('new-project', () => promptNewProject());
  for (let i = 1; i <= 9; i++) {
    shortcutManager.registerHandler(`goto-session-${i}`, () => appState.gotoSession(i - 1));
  }
  shortcutManager.registerHandler('next-session', () => appState.cycleSession(1));
  shortcutManager.registerHandler('prev-session', () => appState.cycleSession(-1));
  shortcutManager.registerHandler('tab-back', () => appState.navigateBack());
  shortcutManager.registerHandler('tab-forward', () => appState.navigateForward());
  shortcutManager.registerHandler('toggle-sidebar', () => toggleSidebar());
  shortcutManager.registerHandler('toggle-split', () => appState.toggleSwarm());
  shortcutManager.registerHandler('project-terminal', () => toggleProjectTerminal());
  shortcutManager.registerHandler('project-terminal-alt', () => toggleProjectTerminal());
  shortcutManager.registerHandler('debug-panel', () => toggleDebugPanel());
  shortcutManager.registerHandler('git-panel', () => toggleGitPanel());
  shortcutManager.registerHandler('quick-open', () => showQuickOpen());
  shortcutManager.registerHandler('find-in-terminal', () => {
    const shellPanel = document.getElementById('project-terminal-panel');
    if (shellPanel && !shellPanel.classList.contains('hidden') &&
        shellPanel.contains(document.activeElement)) {
      const shellSessionId = getActiveShellSessionId();
      if (shellSessionId) {
        showSearchBar(shellSessionId, ShellTerminalSearchBackend(shellSessionId));
        return;
      }
    }

    const session = appState.activeSession;
    if (!session) return;

    if (session.type === 'file-reader') {
      const instance = getFileReaderInstance(session.id);
      if (!instance) return;
      const body = instance.element.querySelector('.file-reader-body') as HTMLElement;
      if (!body) return;
      showSearchBar(session.id, new DomSearchBackend(body, getFileReaderTextSelector(session.id)));
    } else if (session.type === 'diff-viewer') {
      const instance = getFileViewerInstance(session.id);
      if (!instance) return;
      const body = instance.element.querySelector('.file-viewer-body') as HTMLElement;
      if (!body) return;
      showSearchBar(session.id, new DomSearchBackend(body, '.diff-line'));
    } else {
      const sessionId = getFocusedSessionId();
      if (sessionId) showSearchBar(sessionId, TerminalSearchBackend(sessionId));
    }
  });
  shortcutManager.registerHandler('goto-line', () => {
    const session = appState.activeSession;
    if (session?.type === 'file-reader') {
      showGoToLineBar(session.id);
    }
  });
  shortcutManager.registerHandler('help', () => showHelpDialog());
  shortcutManager.registerHandler('ui-zoom-in', () => stepUiAndTerminalZoom(1));
  shortcutManager.registerHandler('ui-zoom-out', () => stepUiAndTerminalZoom(-1));

  document.addEventListener('keydown', (e) => {
    shortcutManager.matchEvent(e);
  });
}
