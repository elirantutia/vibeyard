import { appState } from '../../state.js';
import { onChange as onStatusChange } from '../../session-activity.js';
import { onChange as onGitStatusChange } from '../../git-status.js';
import { onChange as onUnreadChange } from '../../session-unread.js';
import { onChange as onGithubUnreadChange } from '../../github-unread.js';
import { ICON_TERMINAL, ICON_MENU } from '../../icons.js';
import { onShareChange } from '../../sharing/share-manager.js';
import { loadProviderAvailability, hasMultipleAvailableProviders } from '../../provider-availability.js';
import { getActiveContextMenu, hideTabContextMenu } from './menu.js';
import { gitStatusEl } from './dom.js';
import { render, updateTabStatus } from './tab-list.js';
import { renderGitStatus, showBranchContextMenu } from './git-status-bar.js';
import { showMoreMenu, promptNewSession, quickNewSession } from './session-menu.js';

const btnAddSession = document.getElementById('btn-add-session')!;
const btnAddSessionMenu = document.getElementById('btn-add-session-menu')!;
const btnAddBrowserTab = document.getElementById('btn-add-browser-tab')!;
const btnMore = document.getElementById('btn-more')!;
// Terminal toggle is wired in project-terminal.ts; we only own its icon here.
const btnToggleTerminal = document.getElementById('btn-toggle-terminal')!;

export function initTabBar(): void {
  btnToggleTerminal.innerHTML = ICON_TERMINAL;
  btnMore.innerHTML = ICON_MENU;
  // Browser button keeps its CSS-drawn .toolbar-icon-browser glyph from index.html.

  btnAddSession.addEventListener('click', () => quickNewSession());
  btnAddSession.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMoreMenu(e.clientX, e.clientY);
  });
  // The pill's caret opens a custom-session dialog; the More button owns the menu.
  btnAddSessionMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    promptNewSession();
  });
  btnMore.addEventListener('click', (e) => {
    e.stopPropagation();
    if (getActiveContextMenu()) {
      hideTabContextMenu();
      return;
    }
    const rect = btnMore.getBoundingClientRect();
    showMoreMenu(rect.left, rect.bottom + 4);
  });
  btnAddBrowserTab.addEventListener('click', () => {
    const project = appState.activeProject;
    if (project) appState.addBrowserTabSession(project.id);
  });
  gitStatusEl.addEventListener('click', (e) => showBranchContextMenu(e));

  // Icons only distinguish providers when multiple are installed
  loadProviderAvailability().then(() => {
    if (hasMultipleAvailableProviders()) render();
  }).catch(() => {});

  appState.on('state-loaded', render);
  appState.on('project-changed', render);
  appState.on('session-added', render);
  appState.on('session-removed', render);
  appState.on('session-changed', render);
  appState.on('layout-changed', render);
  onShareChange(render);

  onStatusChange(updateTabStatus);

  onUnreadChange(render);
  onGithubUnreadChange(render);

  onGitStatusChange((projectId) => {
    if (projectId === appState.activeProjectId) renderGitStatus();
  });
  appState.on('project-changed', renderGitStatus);

  document.addEventListener('click', hideTabContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTabContextMenu(); });

  render();
}
