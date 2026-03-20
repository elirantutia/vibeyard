import { appState, type ProjectRecord, type SessionRecord } from '../state.js';
import { showModal, closeModal, FieldDef } from './modal.js';
import { onChange as onStatusChange, getStatus, type SessionStatus } from '../session-activity.js';
import { onChange as onGitStatusChange, getGitStatus, type GitStatus } from '../git-status.js';

import { isUnread, onChange as onUnreadChange } from '../session-unread.js';
import { showHelpDialog } from './help-dialog.js';
import { scrollToGitPanel } from './git-panel.js';

const tabListEl = document.getElementById('tab-list')!;
const gitStatusEl = document.getElementById('git-status')!;
const btnAddSession = document.getElementById('btn-add-session')!;
const btnAddMcpInspector = document.getElementById('btn-add-mcp-inspector')!;
const btnToggleSplit = document.getElementById('btn-toggle-split')!;
const btnHelp = document.getElementById('btn-help')!;

let activeContextMenu: HTMLElement | null = null;
const prevStatus = new Map<string, SessionStatus>();

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
  btnToggleSplit.addEventListener('click', () => appState.toggleSplit());
  btnHelp.addEventListener('click', () => showHelpDialog());
  gitStatusEl.addEventListener('click', () => scrollToGitPanel());

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
  input.value = session.name;
  nameSpan.textContent = '';
  nameSpan.appendChild(input);
  input.select();

  let committed = false;
  const commit = () => {
    if (committed) return;
    committed = true;
    const newName = input.value.trim();
    if (newName && newName !== session.name) {
      appState.renameSession(project.id, session.id, newName);
    } else {
      nameSpan.textContent = session.name;
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      nameSpan.textContent = session.name;
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
  closeItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    appState.removeSession(project.id, session.id);
  });

  const sessionIdx = project.sessions.findIndex((s) => s.id === session.id);
  const totalSessions = project.sessions.length;

  const separator = document.createElement('div');
  separator.className = 'tab-context-menu-separator';

  const closeAllItem = document.createElement('div');
  closeAllItem.className = 'tab-context-menu-item';
  closeAllItem.textContent = 'Close All';
  closeAllItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideTabContextMenu();
    appState.removeAllSessions(project.id);
  });

  const closeOthersItem = document.createElement('div');
  closeOthersItem.className = 'tab-context-menu-item' + (totalSessions <= 1 ? ' disabled' : '');
  closeOthersItem.textContent = 'Close Others';
  if (totalSessions > 1) {
    closeOthersItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      appState.removeOtherSessions(project.id, session.id);
    });
  }

  const closeRightItem = document.createElement('div');
  closeRightItem.className = 'tab-context-menu-item' + (sessionIdx >= totalSessions - 1 ? ' disabled' : '');
  closeRightItem.textContent = 'Close to the Right';
  if (sessionIdx < totalSessions - 1) {
    closeRightItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      appState.removeSessionsFromRight(project.id, session.id);
    });
  }

  const closeLeftItem = document.createElement('div');
  closeLeftItem.className = 'tab-context-menu-item' + (sessionIdx <= 0 ? ' disabled' : '');
  closeLeftItem.textContent = 'Close to the Left';
  if (sessionIdx > 0) {
    closeLeftItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
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

  const moveSeparator = document.createElement('div');
  moveSeparator.className = 'tab-context-menu-separator';

  menu.appendChild(renameItem);
  menu.appendChild(moveLeftItem);
  menu.appendChild(moveRightItem);
  menu.appendChild(moveSeparator);
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
    const isSpecial = isMcp || isDiff || isFileReader;
    tab.className = 'tab-item' + (isActive ? ' active' : '') + (unread ? ' unread' : '');
    tab.dataset.sessionId = session.id;
    tab.draggable = true;
    tab.title = isDiff ? `Diff: ${session.diffFilePath || session.name}` : isMcp ? `MCP Inspector` : isFileReader ? `File: ${session.fileReaderPath || session.name}` : buildTooltip(getStatus(session.id), session.cliSessionId);
    const namePrefix = isDiff ? '<span class="tab-diff-badge">DIFF</span> ' : isMcp ? '<span class="tab-mcp-badge">MCP</span> ' : isFileReader ? '<span class="tab-file-badge">FILE</span> ' : '';
    const statusDot = isSpecial ? '' : `<span class="tab-status ${getStatus(session.id)}"></span>`;
    tab.innerHTML = `
      ${statusDot}
      <span class="tab-name">${namePrefix}${esc(session.name)}</span>
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

    // Double-click to rename
    tab.addEventListener('dblclick', () => startRename(tab, project, session));

    // Right-click context menu
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTabContextMenu(e.clientX, e.clientY, project, session, tab);
    });

    // Close button
    tab.querySelector('.tab-close')!.addEventListener('click', () => {
      appState.removeSession(project.id, session.id);
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

  // Update split toggle button visual
  btnToggleSplit.style.color = project.layout.mode === 'split' ? 'var(--accent)' : '';
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

export function quickNewSession(): void {
  const project = appState.activeProject;
  if (!project) return;
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

  menu.appendChild(quickItem);
  menu.appendChild(customItem);
  document.body.appendChild(menu);
  activeContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

export function promptNewSession(): void {
  const project = appState.activeProject;
  if (!project) return;

  const sessionNum = project.sessions.length + 1;

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

  showModal('New Session', fields, (values) => {
    const name = values['session-name']?.trim();
    if (name) {
      closeModal();
      const args = values['session-args']?.trim() || undefined;
      const keepArgs = values['keep-args'] === 'true';
      project.defaultArgs = keepArgs ? (args || undefined) : undefined;
      appState.addSession(project.id, name, args);
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
