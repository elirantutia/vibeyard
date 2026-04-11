import { appState, MAX_SESSION_NAME_LENGTH, type ProjectRecord, type SessionRecord } from '../state.js';
import type { ProviderId } from '../../shared/types.js';
import { showModal, closeModal, setModalError, FieldDef } from './modal.js';
import { onChange as onStatusChange, getStatus, type SessionStatus } from '../session-activity.js';
import { onChange as onGitStatusChange, getGitStatus, getActiveGitPath, refreshGitStatus } from '../git-status.js';

import { showConfirmDialog } from './confirm-dialog.js';
import { countActiveStatuses, buildWarningBannerDetail } from './confirm-helpers.js';
import { isUnread, onChange as onUnreadChange } from '../session-unread.js';
import { showHelpDialog } from './help-dialog.js';
import { showShareDialog } from './share-dialog.js';
import { showJoinDialog } from './join-dialog.js';
import { isSharing } from '../sharing/peer-host.js';
import { endShare, onShareChange } from '../sharing/share-manager.js';
import { openInspector, isInspectorOpen, getInspectedSessionId, closeInspector } from './session-inspector.js';
import { loadProviderAvailability, hasMultipleAvailableProviders, getProviderAvailabilitySnapshot, getProviderCapabilities } from '../provider-availability.js';
import { buildResumeWithProviderItems } from './resume-with-provider-menu.js';

const tabListEl = document.getElementById('tab-list')!;
const gitStatusEl = document.getElementById('git-status')!;
const btnAddSession = document.getElementById('btn-add-session')!;
const btnAddMcpInspector = document.getElementById('btn-add-mcp-inspector')!;
const btnToggleSwarm = document.getElementById('btn-toggle-swarm')!;
const btnHelp = document.getElementById('btn-help')!;

let activeContextMenu: HTMLElement | null = null;
const prevStatus = new Map<string, SessionStatus>();

async function confirmBeforeClose(sessionId: string, sessionName: string): Promise<boolean> {
  const status = getStatus(sessionId);
  const isActive = status === 'working' || status === 'waiting' || status === 'input';

  if (isActive && appState.preferences.confirmCloseActive) {
    const statusWord = status === 'input' ? 'waiting for input' : status;
    return showConfirmDialog({
      title: 'Close active session?',
      message: `<span style="color:${status === 'working' ? '#e94560' : status === 'waiting' ? '#f4b400' : '#e67e22'}">&#9679;</span> &nbsp;<strong>${escapeHtml(sessionName)}</strong> is currently ${statusWord}.`,
      confirmLabel: 'Close',
      confirmDangerous: true,
    });
  }

  if (!isActive && appState.preferences.confirmCloseInactive) {
    return showConfirmDialog({
      title: 'Close session?',
      message: `Close "${escapeHtml(sessionName)}"?`,
      confirmLabel: 'Close',
    });
  }

  return true;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function buildTooltip(status: SessionStatus, cliSessionId?: string): string {
  const statusLine = `Status: ${status}`;
  return cliSessionId ? `${statusLine}\nSession: ${cliSessionId}` : statusLine;
}

export function initTabBar(): void {
  btnAddSession.addEventListener('click', () => quickNewSession());
  btnAddSession.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showAddSessionContextMenu(e.clientX, e.clientY);
  });
  btnAddMcpInspector.addEventListener('click', promptNewMcpInspector);
  btnToggleSwarm.addEventListener('click', () => appState.toggleSwarm());
  btnHelp.addEventListener('click', () => showHelpDialog());
  gitStatusEl.addEventListener('click', (e) => showBranchContextMenu(e));

  // Icons only distinguish providers when multiple are installed
  loadProviderAvailability().then(() => {
    if (hasMultipleAvailableProviders()) render();
  }).catch(() => {});

  appState.on('state-loaded', render);
  appState.on('project-changed', render);
  appState.on('session-added', render);
  appState.on('session-removed', (data?: unknown) => {
    const d = data as { sessionId?: string } | undefined;
    if (d?.sessionId) {
      prevStatus.delete(d.sessionId);
    }
    render();
  });
  appState.on('session-changed', render);
  appState.on('layout-changed', render);
  onShareChange(render);

  onStatusChange((sessionId, status) => {
    const prev = prevStatus.get(sessionId);
    prevStatus.set(sessionId, status);

    const dot = tabListEl.querySelector(`.tab-item[data-session-id="${sessionId}"] .tab-status`) as HTMLElement | null;
    if (dot) {
      dot.className = `tab-status ${status}`;
    }
    const tab = tabListEl.querySelector(`.tab-item[data-session-id="${sessionId}"]`) as HTMLElement | null;
    if (tab) {
      const session = appState.activeProject?.sessions.find(s => s.id === sessionId);
      tab.title = buildTooltip(status, session?.cliSessionId);
    }

  });

  onUnreadChange(render);

  onGitStatusChange((projectId) => {
    if (projectId === appState.activeProjectId) renderGitStatus();
  });
  appState.on('project-changed', renderGitStatus);

  document.addEventListener('click', hideTabContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTabContextMenu(); });

  render();
}

function startRename(tab: HTMLElement, project: ProjectRecord, session: SessionRecord): void {
  const nameSpan = tab.querySelector('.tab-name') as HTMLElement;
  if (nameSpan.querySelector('input')) return;

  const input = document.createElement('input');
  input.maxLength = MAX_SESSION_NAME_LENGTH;
  input.value = session.name;
  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    input.remove();
    if (newName && newName !== session.name) {
      appState.renameSession(project.id, session.id, newName, true);
    } else {
      render();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      committed = true;
      input.remove();
      render();
    }
  });

  input.addEventListener('blur', commit);
}

function showTabContextMenu(x: number, y: number, project: ProjectRecord, session: SessionRecord, tab: HTMLElement): void {
  hideTabContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const renameItem = document.createElement('div');
  renameItem.className = 'tab-context-menu-item';
  renameItem.textContent = 'Rename';
  renameItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    startRename(tab, project, session);
  });

  const closeItem = document.createElement('div');
  closeItem.className = 'tab-context-menu-item';
  closeItem.textContent = 'Close';
  closeItem.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    if (await confirmBeforeClose(session.id, session.name)) {
      appState.removeSession(project.id, session.id);
    }
  });

  const sessionIdx = project.sessions.findIndex((s) => s.id === session.id);
  const totalSessions = project.sessions.length;

  const separator = document.createElement('div');
  separator.className = 'tab-context-menu-separator';

  const closeAllItem = document.createElement('div');
  closeAllItem.className = 'tab-context-menu-item';
  closeAllItem.textContent = 'Close All';
  closeAllItem.addEventListener('click', async (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    const statuses = project.sessions.map(s => getStatus(s.id));
    const counts = countActiveStatuses(statuses);
    const hasActive = counts.working + counts.waiting + counts.input > 0;

    if (hasActive && appState.preferences.confirmCloseActive) {
      const detail = buildWarningBannerDetail(counts);
      const confirmed = await showConfirmDialog({
        title: 'Close all sessions?',
        message: '',
        detail,
        confirmLabel: 'Close All',
        confirmDangerous: true,
      });
      if (!confirmed) return;
    }
    appState.removeAllSessions(project.id);
  });

  const closeOthersItem = document.createElement('div');
  closeOthersItem.className = 'tab-context-menu-item' + (totalSessions <= 1 ? ' disabled' : '');
  closeOthersItem.textContent = 'Close Others';
  if (totalSessions > 1) {
    closeOthersItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      const others = project.sessions.filter(s => s.id !== session.id);
      const statuses = others.map(s => getStatus(s.id));
      const counts = countActiveStatuses(statuses);
      const hasActive = counts.working + counts.waiting + counts.input > 0;

      if (hasActive && appState.preferences.confirmCloseActive) {
        const detail = buildWarningBannerDetail(counts);
        const confirmed = await showConfirmDialog({
          title: 'Close other sessions?',
          message: '',
          detail,
          confirmLabel: 'Close Others',
          confirmDangerous: true,
        });
        if (!confirmed) return;
      }
      appState.removeOtherSessions(project.id, session.id);
    });
  }

  const closeRightItem = document.createElement('div');
  closeRightItem.className = 'tab-context-menu-item' + (sessionIdx >= totalSessions - 1 ? ' disabled' : '');
  closeRightItem.textContent = 'Close to the Right';
  if (sessionIdx < totalSessions - 1) {
    closeRightItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      const rightSessions = project.sessions.slice(sessionIdx + 1);
      const statuses = rightSessions.map(s => getStatus(s.id));
      const counts = countActiveStatuses(statuses);
      const hasActive = counts.working + counts.waiting + counts.input > 0;

      if (hasActive && appState.preferences.confirmCloseActive) {
        const detail = buildWarningBannerDetail(counts);
        const confirmed = await showConfirmDialog({
          title: 'Close sessions to the right?',
          message: '',
          detail,
          confirmLabel: 'Close to Right',
          confirmDangerous: true,
        });
        if (!confirmed) return;
      }
      appState.removeSessionsFromRight(project.id, session.id);
    });
  }

  const closeLeftItem = document.createElement('div');
  closeLeftItem.className = 'tab-context-menu-item' + (sessionIdx <= 0 ? ' disabled' : '');
  closeLeftItem.textContent = 'Close to the Left';
  if (sessionIdx > 0) {
    closeLeftItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      const leftSessions = project.sessions.slice(0, sessionIdx);
      const statuses = leftSessions.map(s => getStatus(s.id));
      const counts = countActiveStatuses(statuses);
      const hasActive = counts.working + counts.waiting + counts.input > 0;

      if (hasActive && appState.preferences.confirmCloseActive) {
        const detail = buildWarningBannerDetail(counts);
        const confirmed = await showConfirmDialog({
          title: 'Close sessions to the left?',
          message: '',
          detail,
          confirmLabel: 'Close to Left',
          confirmDangerous: true,
        });
        if (!confirmed) return;
      }
      appState.removeSessionsFromLeft(project.id, session.id);
    });
  }

  const moveLeftItem = document.createElement('div');
  moveLeftItem.className = 'tab-context-menu-item' + (sessionIdx <= 0 ? ' disabled' : '');
  moveLeftItem.textContent = 'Move Left';
  if (sessionIdx > 0) {
    moveLeftItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      appState.reorderSession(project.id, session.id, sessionIdx - 1);
    });
  }

  const moveRightItem = document.createElement('div');
  moveRightItem.className = 'tab-context-menu-item' + (sessionIdx >= totalSessions - 1 ? ' disabled' : '');
  moveRightItem.textContent = 'Move Right';
  if (sessionIdx < totalSessions - 1) {
    moveRightItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      appState.reorderSession(project.id, session.id, sessionIdx + 1);
    });
  }

  // Share menu items — only for CLI sessions (not special types)
  const isCliSession = !session.type || session.type === 'claude';
  const isRemote = session.type === 'remote-terminal';
  const providerCapabilities = getProviderCapabilities(session.providerId || 'claude');
  const canInspect = isCliSession && providerCapabilities?.hookStatus !== false;
  const currentlySharing = isSharing(session.id);

  const shareSeparator = document.createElement('div');
  shareSeparator.className = 'tab-context-menu-separator';

  const shareItem = document.createElement('div');
  shareItem.className = 'tab-context-menu-item' + (!isCliSession || currentlySharing ? ' disabled' : '');
  shareItem.textContent = 'Share Session\u2026';
  if (isCliSession && !currentlySharing) {
    shareItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      showShareDialog(session.id);
    });
  }

  const stopShareItem = document.createElement('div');
  stopShareItem.className = 'tab-context-menu-item' + (!currentlySharing ? ' disabled' : '');
  stopShareItem.textContent = 'Stop Sharing';
  if (currentlySharing) {
    stopShareItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      endShare(session.id);
    });
  }

  menu.appendChild(renameItem);
  menu.appendChild(moveLeftItem);
  menu.appendChild(moveRightItem);

  if (appState.preferences.debugMode) {
    const sessionSeparator = document.createElement('div');
    sessionSeparator.className = 'tab-context-menu-separator';

    const cliSessionId = session.cliSessionId;
    const hasCliSession = !!cliSessionId;

    const copySessionIdItem = document.createElement('div');
    copySessionIdItem.className = 'tab-context-menu-item' + (!hasCliSession ? ' disabled' : '');
    copySessionIdItem.textContent = 'Copy CLI Session ID';
    if (hasCliSession) {
      copySessionIdItem.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTabContextMenu();
        navigator.clipboard.writeText(cliSessionId);
      });
    }

    const copyInternalIdItem = document.createElement('div');
    copyInternalIdItem.className = 'tab-context-menu-item';
    copyInternalIdItem.textContent = 'Copy Internal ID';
    copyInternalIdItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      navigator.clipboard.writeText(session.id);
    });

    menu.appendChild(sessionSeparator);
    menu.appendChild(copyInternalIdItem);
    menu.appendChild(copySessionIdItem);
  }

  // Inspect item — only for CLI sessions
  const inspectItem = document.createElement('div');
  const isCurrentlyInspecting = isInspectorOpen() && getInspectedSessionId() === session.id;
  inspectItem.className = 'tab-context-menu-item' + (!canInspect ? ' disabled' : '');
  inspectItem.textContent = isCurrentlyInspecting ? 'Close Inspector' : 'Inspect';
  if (canInspect) {
    inspectItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      if (isCurrentlyInspecting) {
        closeInspector();
      } else {
        openInspector(session.id);
      }
    });
  }

  const moveSeparator = document.createElement('div');
  moveSeparator.className = 'tab-context-menu-separator';
  menu.appendChild(moveSeparator);
  if (isCliSession || isRemote) {
    menu.appendChild(shareSeparator);
    if (!currentlySharing) menu.appendChild(shareItem);
    if (currentlySharing) menu.appendChild(stopShareItem);
  }
  if (canInspect) {
    const inspectSeparator = document.createElement('div');
    inspectSeparator.className = 'tab-context-menu-separator';
    menu.appendChild(inspectSeparator);
    menu.appendChild(inspectItem);
  }

  // Resume with <other provider> — only for CLI sessions
  if (isCliSession) {
    const items = buildResumeWithProviderItems(
      (session.providerId || 'claude') as ProviderId,
      (targetId) => {
        hideTabContextMenu();
        appState.resumeWithProvider(project.id, { sessionId: session.id }, targetId);
      },
    );
    for (const el of items) menu.appendChild(el);
  }

  menu.appendChild(closeItem);
  menu.appendChild(separator);
  menu.appendChild(closeAllItem);
  menu.appendChild(closeOthersItem);
  menu.appendChild(closeRightItem);
  menu.appendChild(closeLeftItem);
  document.body.appendChild(menu);
  activeContextMenu = menu;

  // Adjust if menu goes off-screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

function hideTabContextMenu(): void {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function render(): void {
  if (tabListEl.querySelector('.tab-name input')) return;
  tabListEl.innerHTML = '';
  const project = appState.activeProject;
  if (!project) return;

  for (const session of project.sessions) {
    const tab = document.createElement('div');
    const isActive = session.id === project.activeSessionId;
    const unread = !isActive && isUnread(session.id);
    const isMcp = session.type === 'mcp-inspector';
    const isDiff = session.type === 'diff-viewer';
    const isFileReader = session.type === 'file-reader';
    const isRemoteTab = session.type === 'remote-terminal';
    const isBrowserTab = session.type === 'browser-tab';
    const isSpecial = isMcp || isDiff || isFileReader || isRemoteTab || isBrowserTab;
    const sharing = isSharing(session.id);
    tab.className = 'tab-item' + (isActive ? ' active' : '') + (unread ? ' unread' : '') + (sharing ? ' tab-sharing' : '') + (isRemoteTab ? ' tab-remote' : '');
    tab.dataset.sessionId = session.id;
    tab.draggable = true;
    tab.title = isDiff ? `Diff: ${session.diffFilePath || session.name}` : isMcp ? `MCP Inspector` : isFileReader ? `File: ${session.fileReaderPath || session.name}` : isRemoteTab ? `Remote: ${session.remoteHostName || session.name}` : isBrowserTab ? `Browser: ${session.browserTabUrl || 'New Tab'}` : buildTooltip(getStatus(session.id), session.cliSessionId);
    const providerId = session.providerId || 'claude';
    const providerIcon = hasMultipleAvailableProviders() ? `<img class="tab-provider-icon" src="assets/providers/${providerId}.png" alt="${providerId}" onerror="this.style.display='none'"> ` : '';
    const namePrefix = isDiff ? '<span class="tab-diff-badge">DIFF</span> ' : isMcp ? '<span class="tab-mcp-badge">MCP</span> ' : isFileReader ? '<span class="tab-file-badge">FILE</span> ' : isRemoteTab ? '<span class="tab-remote-badge">P2P</span> ' : isBrowserTab ? '<span class="tab-browser-badge">WEB</span> ' : !isSpecial ? providerIcon : '';
    const shareIndicator = sharing ? '<span class="tab-share-indicator" title="Sharing"></span>' : '';
    const statusDot = isSpecial ? '' : `<span class="tab-status ${getStatus(session.id)}"></span>`;
    tab.innerHTML = `
      ${statusDot}
      <span class="tab-name">${namePrefix}${esc(session.name)}</span>
      ${shareIndicator}
      <span class="tab-close" title="Close session">&times;</span>
    `;

    // Click to switch
    tab.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('tab-close')) return;
      if (tab.querySelector('.tab-name input')) return;
      if (session.id !== project.activeSessionId) {
        appState.setActiveSession(project.id, session.id);
      }
    });

    // Middle-click to close
    tab.addEventListener('auxclick', async (e) => {
      if (e.button === 1) {
        e.preventDefault();
        if (await confirmBeforeClose(session.id, session.name)) {
          appState.removeSession(project.id, session.id);
        }
      }
    });

    // Double-click to rename
    tab.addEventListener('dblclick', () => startRename(tab, project, session));

    // Right-click context menu
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e.clientX, e.clientY, project, session, tab);
    });

    // Close button
    tab.querySelector('.tab-close')!.addEventListener('click', async () => {
      if (await confirmBeforeClose(session.id, session.name)) {
        appState.removeSession(project.id, session.id);
      }
    });

    tab.addEventListener('dragstart', (e) => {
      e.dataTransfer!.effectAllowed = 'move';
      e.dataTransfer!.setData('text/plain', session.id);
      tab.classList.add('dragging');
    });

    tab.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      // Determine left/right half
      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      tab.classList.remove('drag-over-left', 'drag-over-right');
      if (e.clientX < midX) {
        tab.classList.add('drag-over-left');
      } else {
        tab.classList.add('drag-over-right');
      }
    });

    tab.addEventListener('dragleave', () => {
      tab.classList.remove('drag-over-left', 'drag-over-right');
    });

    tab.addEventListener('drop', (e) => {
      e.preventDefault();
      tab.classList.remove('drag-over-left', 'drag-over-right');
      const draggedId = e.dataTransfer!.getData('text/plain');
      if (!draggedId || draggedId === session.id) return;

      const rect = tab.getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      let targetIndex = project.sessions.findIndex(s => s.id === session.id);
      if (e.clientX >= midX) targetIndex++;

      // Adjust for the fact that removing the dragged item shifts indices
      const fromIndex = project.sessions.findIndex(s => s.id === draggedId);
      if (fromIndex < targetIndex) targetIndex--;

      appState.reorderSession(project.id, draggedId, targetIndex);
    });

    tab.addEventListener('dragend', () => {
      tab.classList.remove('dragging');
      // Clean up all drag indicators
      tabListEl.querySelectorAll('.drag-over-left, .drag-over-right').forEach(el => {
        el.classList.remove('drag-over-left', 'drag-over-right');
      });
    });

    tabListEl.appendChild(tab);
  }

  // Update swarm toggle button visual
  btnToggleSwarm.style.color = project.layout.mode === 'swarm' ? 'var(--accent)' : '';
}

function renderGitStatus(): void {
  const project = appState.activeProject;
  if (!project) {
    gitStatusEl.innerHTML = '';
    return;
  }

  const status = getGitStatus(project.id);
  if (!status || !status.isGitRepo) {
    gitStatusEl.innerHTML = '';
    return;
  }

  const parts: string[] = [];

  if (status.branch) {
    parts.push(`<span class="git-branch">\u2387 ${esc(status.branch)}</span>`);
  }

  const ab: string[] = [];
  if (status.ahead > 0) ab.push(`\u2191${status.ahead}`);
  if (status.behind > 0) ab.push(`\u2193${status.behind}`);
  if (ab.length) {
    parts.push(`<span class="git-ahead-behind">${ab.join(' ')}</span>`);
  }

  if (status.staged > 0) parts.push(`<span class="git-staged">+${status.staged}</span>`);
  if (status.modified > 0) parts.push(`<span class="git-modified">~${status.modified}</span>`);
  if (status.untracked > 0) parts.push(`<span class="git-untracked">?${status.untracked}</span>`);
  if (status.conflicted > 0) parts.push(`<span class="git-conflicted">!${status.conflicted}</span>`);

  gitStatusEl.innerHTML = parts.join(' ');
}

async function showBranchContextMenu(e: MouseEvent): Promise<void> {
  e.stopPropagation();
  hideTabContextMenu();

  const project = appState.activeProject;
  if (!project) return;

  const status = getGitStatus(project.id);
  if (!status || !status.isGitRepo) return;

  const gitPath = getActiveGitPath(project.id);

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';

  // Position below the git status element
  const elRect = gitStatusEl.getBoundingClientRect();
  menu.style.left = `${elRect.left}px`;
  menu.style.top = `${elRect.bottom + 4}px`;

  // Show loading
  const loadingItem = document.createElement('div');
  loadingItem.className = 'tab-context-menu-item disabled';
  loadingItem.textContent = 'Loading branches\u2026';
  menu.appendChild(loadingItem);

  document.body.appendChild(menu);
  activeContextMenu = menu;

  try {
    const branches = await window.vibeyard.git.listBranches(gitPath);

    // Menu was dismissed during loading
    if (activeContextMenu !== menu) return;

    menu.innerHTML = '';
    menu.addEventListener('click', (ev) => ev.stopPropagation());

    const searchInput = document.createElement('input');
    searchInput.className = 'branch-search-input';
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter branches\u2026';
    menu.appendChild(searchInput);

    const container = document.createElement('div');
    container.className = 'branch-list-container';
    menu.appendChild(container);

    let filteredBranches = branches;
    let activeIndex = 0;
    let itemElements: HTMLElement[] = [];

    function renderBranchItems(query: string): void {
      const lowerQuery = query.toLowerCase();
      filteredBranches = lowerQuery
        ? branches.filter(b => b.name.toLowerCase().includes(lowerQuery))
        : branches;
      activeIndex = 0;
      itemElements = [];
      container.innerHTML = '';

      if (filteredBranches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'tab-context-menu-item disabled';
        empty.textContent = 'No matching branches';
        container.appendChild(empty);
        return;
      }

      for (let i = 0; i < filteredBranches.length; i++) {
        const branch = filteredBranches[i];
        const item = document.createElement('div');
        item.className = 'tab-context-menu-item'
          + (branch.current ? ' active' : '')
          + (i === activeIndex ? ' keyboard-active' : '');
        item.textContent = (branch.current ? '\u2713 ' : '  ') + branch.name;

        item.addEventListener('mouseenter', () => {
          activeIndex = i;
          setActiveHighlight();
        });

        if (!branch.current) {
          item.addEventListener('click', () => {
            hideTabContextMenu();
            switchBranch(gitPath, branch.name);
          });
        }
        itemElements.push(item);
        container.appendChild(item);
      }
    }

    function setActiveHighlight(): void {
      itemElements.forEach((el, i) => {
        el.classList.toggle('keyboard-active', i === activeIndex);
      });
    }

    function setActiveAndScroll(): void {
      setActiveHighlight();
      itemElements[activeIndex]?.scrollIntoView({ block: 'nearest' });
    }

    searchInput.addEventListener('input', () => renderBranchItems(searchInput.value));

    searchInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault();
          if (filteredBranches.length > 0) {
            activeIndex = (activeIndex + 1) % filteredBranches.length;
            setActiveAndScroll();
          }
          break;
        case 'ArrowUp':
          ev.preventDefault();
          if (filteredBranches.length > 0) {
            activeIndex = (activeIndex - 1 + filteredBranches.length) % filteredBranches.length;
            setActiveAndScroll();
          }
          break;
        case 'Enter':
          ev.preventDefault();
          if (activeIndex < filteredBranches.length) {
            const selected = filteredBranches[activeIndex];
            if (!selected.current) {
              hideTabContextMenu();
              switchBranch(gitPath, selected.name);
            }
          }
          break;
        case 'Escape':
          ev.preventDefault();
          hideTabContextMenu();
          break;
      }
    });

    renderBranchItems('');

    // Separator + Create New Branch
    const separator = document.createElement('div');
    separator.className = 'tab-context-menu-separator';
    menu.appendChild(separator);

    const createItem = document.createElement('div');
    createItem.className = 'tab-context-menu-item';
    createItem.textContent = 'Create New Branch\u2026';
    createItem.addEventListener('click', () => {
      hideTabContextMenu();
      promptCreateBranch(gitPath);
    });
    menu.appendChild(createItem);

    // Adjust if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

    searchInput.focus();
  } catch {
    if (activeContextMenu !== menu) return;
    menu.innerHTML = '';
    const errItem = document.createElement('div');
    errItem.className = 'tab-context-menu-item disabled';
    errItem.textContent = 'Failed to load branches';
    menu.appendChild(errItem);
  }
}

async function switchBranch(gitPath: string, branchName: string): Promise<void> {
  const project = appState.activeProject;
  const freshStatus = project ? getGitStatus(project.id) : null;
  const dirty = freshStatus ? freshStatus.staged + freshStatus.modified + freshStatus.conflicted : 0;
  if (dirty > 0) {
    const confirmed = confirm(`You have uncommitted changes. Switch to "${branchName}" anyway?`);
    if (!confirmed) return;
  }

  try {
    await window.vibeyard.git.checkoutBranch(gitPath, branchName);
    refreshGitStatus();
  } catch (err) {
    alert(`Failed to switch branch: ${err instanceof Error ? err.message : err}`);
  }
}

function promptCreateBranch(gitPath: string): void {
  showModal('Create New Branch', [
    { label: 'Branch name', id: 'branch-name', placeholder: 'feature/my-branch' },
  ], async (values) => {
    const name = values['branch-name']?.trim();
    if (!name) {
      setModalError('branch-name', 'Branch name is required');
      return;
    }
    if (/\s/.test(name)) {
      setModalError('branch-name', 'Branch name cannot contain spaces');
      return;
    }
    try {
      await window.vibeyard.git.createBranch(gitPath, name);
      closeModal();
      refreshGitStatus();
    } catch (err) {
      setModalError('branch-name', err instanceof Error ? err.message : 'Failed to create branch');
    }
  });
}

export function quickNewSession(): void {
  const project = appState.activeProject;
  if (!project) return;
  (document.activeElement as HTMLElement)?.blur?.();
  const sessionNum = project.sessions.length + 1;
  appState.addSession(project.id, `Session ${sessionNum}`);
}

function showAddSessionContextMenu(x: number, y: number): void {
  hideTabContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const quickItem = document.createElement('div');
  quickItem.className = 'tab-context-menu-item';
  quickItem.textContent = 'New Session';
  quickItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    quickNewSession();
  });

  const customItem = document.createElement('div');
  customItem.className = 'tab-context-menu-item';
  customItem.textContent = 'New Custom Session\u2026';
  customItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    promptNewSession();
  });

  const joinSeparator = document.createElement('div');
  joinSeparator.className = 'tab-context-menu-separator';

  const joinItem = document.createElement('div');
  joinItem.className = 'tab-context-menu-item';
  joinItem.textContent = 'Join Remote Session\u2026';
  joinItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    showJoinDialog();
  });

  const browserItem = document.createElement('div');
  browserItem.className = 'tab-context-menu-item';
  browserItem.textContent = 'New Browser Tab';
  browserItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    const project = appState.activeProject;
    if (project) appState.addBrowserTabSession(project.id);
  });

  menu.appendChild(quickItem);
  menu.appendChild(customItem);
  menu.appendChild(browserItem);
  menu.appendChild(joinSeparator);
  menu.appendChild(joinItem);
  document.body.appendChild(menu);
  activeContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

export async function promptNewSession(onCreated?: (session: SessionRecord) => void): Promise<void> {
  const project = appState.activeProject;
  if (!project) return;

  const sessionNum = project.sessions.length + 1;

  let providerSnapshot = getProviderAvailabilitySnapshot();
  if (!providerSnapshot) {
    await loadProviderAvailability();
    providerSnapshot = getProviderAvailabilitySnapshot();
  }
  const providers = providerSnapshot?.providers ?? [];
  const availabilityMap = providerSnapshot?.availability ?? new Map();

  const fields: FieldDef[] = [
    { label: 'Name', id: 'session-name', placeholder: `Session ${sessionNum}`, defaultValue: `Session ${sessionNum}` },
    { label: 'Arguments', id: 'session-args', placeholder: 'e.g. --model sonnet', defaultValue: project.defaultArgs ?? '' },
    {
      label: 'Keep args for future sessions',
      id: 'keep-args',
      type: 'checkbox',
      defaultValue: project.defaultArgs ? 'true' : undefined,
    },
  ];

  if (providers.length > 1) {
    const preferred = appState.preferences.defaultProvider ?? 'claude';
    const firstAvailable = (availabilityMap.get(preferred) ? preferred : providers.find(p => availabilityMap.get(p.id))?.id) ?? 'claude';
    fields.unshift({
      label: 'Provider',
      id: 'provider',
      type: 'select',
      defaultValue: firstAvailable,
      options: providers.map(p => {
        const available = availabilityMap.get(p.id);
        return { value: p.id, label: available ? p.displayName : `${p.displayName} (not installed)`, disabled: !available };
      }),
    });
  }

  showModal('New Session', fields, (values) => {
    const name = values['session-name']?.trim();
    if (name) {
      closeModal();
      const args = values['session-args']?.trim() || undefined;
      const keepArgs = values['keep-args'] === 'true';
      project.defaultArgs = keepArgs ? (args || undefined) : undefined;
      const providerId = (values['provider'] || 'claude') as ProviderId;
      const session = appState.addSession(project.id, name, args, providerId);
      if (session && onCreated) onCreated(session);
    }
  });
}

function promptNewMcpInspector(): void {
  const project = appState.activeProject;
  if (!project) return;

  const inspectorNum = project.sessions.filter(s => s.type === 'mcp-inspector').length + 1;
  showModal('New MCP Inspector', [
    { label: 'Name', id: 'inspector-name', placeholder: `Inspector ${inspectorNum}`, defaultValue: `Inspector ${inspectorNum}` },
  ], (values) => {
    const name = values['inspector-name']?.trim();
    if (name) {
      closeModal();
      appState.addMcpInspectorSession(project.id, name);
    }
  });
}

function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}
