import { appState, ProjectRecord } from '../state.js';
import { isUnread, onChange as onUnreadChange } from '../session-unread.js';
import {
  createTerminalPane,
  attachToContainer,
  showPane,
  hideAllPanes,
  fitAllVisible,
  setFocused,
  spawnTerminal,
  destroyTerminal,
  getTerminalInstance,
} from './terminal-pane.js';
import {
  createInspectorPane,
  destroyInspectorPane,
  showInspectorPane,
  hideAllInspectorPanes,
  attachInspectorToContainer,
  getInspectorInstance,
  disconnectInspector,
} from './mcp-inspector.js';
import { isInspectorOpen } from './session-inspector.js';
import {
  createFileViewerPane,
  destroyFileViewerPane,
  showFileViewerPane,
  hideAllFileViewerPanes,
  attachFileViewerToContainer,
  getFileViewerInstance,
} from './file-viewer.js';
import {
  createFileReaderPane,
  destroyFileReaderPane,
  showFileReaderPane,
  hideAllFileReaderPanes,
  attachFileReaderToContainer,
  getFileReaderInstance,
  setFileReaderLine,
} from './file-reader.js';
import {
  getRemoteTerminalInstance,
  destroyRemoteTerminal,
  attachRemoteToContainer,
  showRemotePane,
  hideAllRemotePanes,
} from './remote-terminal-pane.js';
import { quickNewSession } from './tab-bar.js';

const container = document.getElementById('terminal-container')!;

/** Set the container's layout class while preserving the inspector-open class if active. */
function setContainerClass(cls: string): void {
  const hasInspector = isInspectorOpen();
  container.className = cls;
  if (hasInspector) container.classList.add('inspector-open');
}

export function initSplitLayout(): void {
  appState.on('state-loaded', renderLayout);
  appState.on('project-changed', renderLayout);
  appState.on('session-added', onSessionAdded);
  appState.on('session-removed', onSessionRemoved);
  appState.on('session-changed', renderLayout);
  appState.on('layout-changed', renderLayout);

  onUnreadChange(() => {
    const project = appState.activeProject;
    if (project?.layout.mode === 'swarm') updateSwarmPaneStyles(project);
  });

  // Refit on window resize
  window.addEventListener('resize', () => {
    requestAnimationFrame(fitAllVisible);
  });

  // Click delegation for swarm mode: clicking a dimmed pane makes it active
  container.addEventListener('mousedown', (e) => {
    const project = appState.activeProject;
    if (!project || project.layout.mode !== 'swarm') return;

    const paneEl = (e.target as HTMLElement).closest('.terminal-pane') as HTMLElement | null;
    if (!paneEl) return;

    const sessionId = paneEl.dataset.sessionId;
    if (sessionId && sessionId !== project.activeSessionId) {
      appState.setActiveSession(project.id, sessionId);
    }
  });
}

function onSessionAdded(data: unknown): void {
  const { session } = data as { projectId: string; session: { id: string; type?: string; cliSessionId: string | null; providerId?: string; args?: string; diffFilePath?: string; diffArea?: string; worktreePath?: string; fileReaderPath?: string; fileReaderLine?: number } };
  const project = appState.activeProject;
  if (!project) return;

  if (session.type === 'file-reader') {
    createFileReaderPane(session.id, session.fileReaderPath || '', session.fileReaderLine);
    renderLayout();
  } else if (session.type === 'diff-viewer') {
    createFileViewerPane(session.id, session.diffFilePath || '', session.diffArea || '', session.worktreePath);
    renderLayout();
  } else if (session.type === 'mcp-inspector') {
    createInspectorPane(session.id);
    renderLayout();
  } else if (session.type === 'remote-terminal') {
    // Remote terminal pane is created by share-manager before session-added fires
    renderLayout();
  } else {
    // Create and spawn immediately
    createTerminalPane(session.id, project.path, session.cliSessionId, !!session.cliSessionId, session.args || '', (session.providerId as import('../../shared/types').ProviderId) || 'claude', project.id);
    renderLayout();

    // Spawn after layout is rendered so terminal has dimensions
    requestAnimationFrame(() => {
      spawnTerminal(session.id);
      fitAllVisible();
    });
  }
}

function onSessionRemoved(data: unknown): void {
  const { sessionId } = data as { projectId: string; sessionId: string };
  if (getFileReaderInstance(sessionId)) {
    destroyFileReaderPane(sessionId);
  } else if (getFileViewerInstance(sessionId)) {
    destroyFileViewerPane(sessionId);
  } else if (getInspectorInstance(sessionId)) {
    disconnectInspector(sessionId);
    destroyInspectorPane(sessionId);
  } else if (getRemoteTerminalInstance(sessionId)) {
    destroyRemoteTerminal(sessionId);
  } else {
    destroyTerminal(sessionId);
  }
  renderLayout();
}

export function renderLayout(): void {
  const project = appState.activeProject;

  if (!project || project.sessions.length === 0) {
    hideAllPanes();
    setContainerClass('');
    showEmptyState(project);
    return;
  }

  removeEmptyState();
  container.querySelectorAll('.swarm-grid-wrapper').forEach(el => el.remove());
  container.querySelectorAll('.swarm-empty-cell').forEach(el => el.remove());

  // Ensure all sessions have their respective instances
  for (const session of project.sessions) {
    if (session.type === 'file-reader') {
      if (!getFileReaderInstance(session.id)) {
        createFileReaderPane(session.id, session.fileReaderPath || '', session.fileReaderLine);
      }
    } else if (session.type === 'diff-viewer') {
      if (!getFileViewerInstance(session.id)) {
        createFileViewerPane(session.id, session.diffFilePath || '', session.diffArea || '', session.worktreePath);
      }
    } else if (session.type === 'mcp-inspector') {
      if (!getInspectorInstance(session.id)) {
        createInspectorPane(session.id);
      }
    } else if (session.type === 'remote-terminal') {
      // Remote terminal instances are created by share-manager, skip here
    } else {
      if (!getTerminalInstance(session.id)) {
        createTerminalPane(session.id, project.path, session.cliSessionId, !!session.cliSessionId, session.args || '', session.providerId || 'claude', project.id);
      }
    }
  }

  hideAllPanes();
  hideAllInspectorPanes();
  hideAllFileViewerPanes();
  hideAllFileReaderPanes();
  hideAllRemotePanes();

  if (project.layout.mode === 'swarm' && project.layout.splitPanes.length >= 1) {
    renderSwarmMode(project);
  } else if (project.layout.mode === 'split' && project.layout.splitPanes.length > 1) {
    renderSplitMode(project);
  } else {
    renderTabMode(project);
  }

  requestAnimationFrame(fitAllVisible);
}

/** Attach and show a non-CLI session pane (file-reader, diff-viewer, mcp-inspector). */
function attachNonCliPane(session: { id: string; type?: string; fileReaderLine?: number }, target: HTMLElement, inSplit: boolean): void {
  if (session.type === 'file-reader') {
    attachFileReaderToContainer(session.id, target);
    showFileReaderPane(session.id, inSplit);
    if (session.fileReaderLine) {
      setFileReaderLine(session.id, session.fileReaderLine);
    }
  } else if (session.type === 'diff-viewer') {
    attachFileViewerToContainer(session.id, target);
    showFileViewerPane(session.id, inSplit);
  } else if (session.type === 'mcp-inspector') {
    attachInspectorToContainer(session.id, target);
    showInspectorPane(session.id, inSplit);
  } else if (session.type === 'remote-terminal') {
    attachRemoteToContainer(session.id, target);
    showRemotePane(session.id, inSplit);
  }
}

function renderTabMode(project: ProjectRecord): void {
  setContainerClass('');
  container.style.gridTemplateColumns = '';
  container.style.gridTemplateRows = '';

  const activeId = project.activeSessionId;
  if (!activeId) return;

  const activeSession = project.sessions.find(s => s.id === activeId);
  if (activeSession?.type && activeSession.type !== 'claude') {
    attachNonCliPane(activeSession, container, false);
    return;
  }

  attachToContainer(activeId, container);
  showPane(activeId, false);

  // Don't steal focus from an active tab rename input
  if (!document.querySelector('#tab-list .tab-name input')) {
    setFocused(activeId);
  }

  const instance = getTerminalInstance(activeId);
  if (instance && !instance.spawned && !instance.exited) {
    requestAnimationFrame(() => {
      spawnTerminal(activeId);
      fitAllVisible();
    });
  }
}

/** Attach, show, and ensure-spawn for each pane in the list. */
function showPanes(project: ProjectRecord, target: HTMLElement = container): void {
  for (const paneId of project.layout.splitPanes) {
    const session = project.sessions.find(s => s.id === paneId);
    if (session?.type && session.type !== 'claude') {
      attachNonCliPane(session, target, true);
      continue;
    }

    attachToContainer(paneId, target);
    showPane(paneId, true);

    const instance = getTerminalInstance(paneId);
    if (instance && !instance.spawned && !instance.exited) {
      requestAnimationFrame(() => spawnTerminal(paneId));
    }
  }
}

function focusActivePane(project: ProjectRecord): void {
  // Don't steal focus from an active tab rename input
  if (document.querySelector('#tab-list .tab-name input')) return;

  if (project.activeSessionId && project.layout.splitPanes.includes(project.activeSessionId)) {
    setFocused(project.activeSessionId);
  } else if (project.layout.splitPanes.length > 0) {
    setFocused(project.layout.splitPanes[0]);
  }
}

function renderSplitMode(project: ProjectRecord): void {
  setContainerClass(`split-${project.layout.splitDirection}`);
  container.style.gridTemplateColumns = '';
  container.style.gridTemplateRows = '';
  showPanes(project);
  focusActivePane(project);
}

function renderSwarmMode(project: ProjectRecord): void {
  const count = project.layout.splitPanes.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);

  const activeSession = project.sessions.find(s => s.id === project.activeSessionId);
  const nonCliSession = (activeSession?.type && activeSession.type !== 'claude')
    ? activeSession
    : [...project.sessions].reverse().find(s => s.type && s.type !== 'claude');

  setContainerClass('swarm-mode');

  if (nonCliSession) {
    container.style.gridTemplateColumns = '1fr 1fr';
    container.style.gridTemplateRows = '1fr';

    const gridWrapper = document.createElement('div');
    gridWrapper.className = 'swarm-grid-wrapper';
    gridWrapper.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    gridWrapper.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    container.appendChild(gridWrapper);

    showPanes(project, gridWrapper);
    appendEmptyCells(cols * rows - count, gridWrapper);
    attachNonCliPane(nonCliSession, container, true);
  } else {
    container.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    container.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    showPanes(project);
    appendEmptyCells(cols * rows - count, container);
  }

  updateSwarmPaneStyles(project);
  focusActivePane(project);
}

function appendEmptyCells(count: number, target: HTMLElement): void {
  for (let i = 0; i < count; i++) {
    const cell = document.createElement('div');
    cell.className = 'swarm-empty-cell';

    const btn = document.createElement('button');
    btn.className = 'swarm-empty-add-btn';
    btn.textContent = '+';
    btn.title = 'New session';
    btn.addEventListener('click', () => quickNewSession());

    cell.appendChild(btn);
    target.appendChild(cell);
  }
}

function updateSwarmPaneStyles(project: ProjectRecord): void {
  for (const paneId of project.layout.splitPanes) {
    const instance = getTerminalInstance(paneId);
    if (instance) {
      const isActive = paneId === project.activeSessionId;
      instance.element.classList.toggle('swarm-dimmed', !isActive);
      instance.element.classList.toggle('swarm-unread', !isActive && isUnread(paneId));
    }
  }
}

function showEmptyState(project: ProjectRecord | undefined): void {
  removeEmptyState();
  const el = document.createElement('div');
  el.className = 'empty-state';
  if (!project) {
    el.innerHTML = `
      <div>No project selected</div>
      <div class="hint">Create a project with the + button in the sidebar</div>
    `;
  } else {
    el.innerHTML = `
      <div>No sessions in "${project.name}"</div>
      <div class="hint">Create a session with the + button in the tab bar</div>
    `;
  }
  container.appendChild(el);
}

function removeEmptyState(): void {
  container.querySelector('.empty-state')?.remove();
}
