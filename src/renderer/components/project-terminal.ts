import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { appState } from '../state.js';
import { fitAllVisible } from './terminal-pane.js';
import { destroySearchBar, hideSearchBar } from './search-bar.js';
import { shortcutManager, displayKeys } from '../shortcuts.js';
import { attachClipboardCopyHandler } from './terminal-utils.js';
import { esc } from '../dom-utils.js';

interface ShellTerminalInstance {
  id: string;
  label: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement;
  projectId: string;
  sessionId: string;
  spawned: boolean;
}

const shells = new Map<string, ShellTerminalInstance[]>();
const activeShellByProject = new Map<string, string>();

let panelEl: HTMLElement;
let containerEl: HTMLElement;
let sidebarEl: HTMLElement;
let resizeHandleEl: HTMLElement;
let currentProjectId: string | null = null;
let resizeObserver: ResizeObserver | null = null;

function findShellBySessionId(sessionId: string): ShellTerminalInstance | undefined {
  for (const list of shells.values()) {
    for (const instance of list) {
      if (instance.sessionId === sessionId) return instance;
    }
  }
  return undefined;
}

function getShellsFor(projectId: string): ShellTerminalInstance[] {
  let list = shells.get(projectId);
  if (!list) {
    list = [];
    shells.set(projectId, list);
  }
  return list;
}

function nextLabel(projectId: string): string {
  const list = getShellsFor(projectId);
  const used = new Set<number>();
  for (const s of list) {
    const m = /^Terminal (\d+)$/.exec(s.label);
    if (m) used.add(parseInt(m[1], 10));
  }
  let n = 1;
  while (used.has(n)) n++;
  return `Terminal ${n}`;
}

function createShell(projectId: string): ShellTerminalInstance {
  const element = document.createElement('div');
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.position = 'relative';

  const terminal = new Terminal({
    theme: {
      background: '#000000',
      foreground: '#e0e0e0',
      cursor: '#e94560',
      selectionBackground: '#ff6b85a6',
      black: '#000000',
      red: '#e94560',
      green: '#0f9b58',
      yellow: '#f4b400',
      blue: '#4285f4',
      magenta: '#ab47bc',
      cyan: '#00acc1',
      white: '#e0e0e0',
    },
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
    cursorBlink: true,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  const shellId = crypto.randomUUID();
  const sessionId = `shell-${projectId}-${shellId}`;

  attachClipboardCopyHandler(terminal, undefined, (data) => window.vibeyard.pty.write(sessionId, data));

  const instance: ShellTerminalInstance = {
    id: shellId,
    label: nextLabel(projectId),
    terminal,
    fitAddon,
    searchAddon,
    element,
    projectId,
    sessionId,
    spawned: false,
  };

  terminal.onData((data) => {
    window.vibeyard.pty.write(sessionId, data);
  });

  getShellsFor(projectId).push(instance);
  return instance;
}

async function spawnShell(instance: ShellTerminalInstance, projectPath: string): Promise<void> {
  if (instance.spawned) return;
  instance.spawned = true;

  const overlay = instance.element.querySelector('.terminal-exit-overlay');
  if (overlay) overlay.remove();

  await window.vibeyard.pty.createShell(instance.sessionId, projectPath);
}

function activateShellInstance(instance: ShellTerminalInstance): void {
  for (const list of shells.values()) {
    for (const other of list) {
      if (other !== instance) {
        other.element.style.display = 'none';
      }
    }
  }

  if (!containerEl.contains(instance.element)) {
    containerEl.appendChild(instance.element);
    instance.terminal.open(instance.element);
    try {
      instance.terminal.loadAddon(new WebglAddon());
    } catch {
      // Software fallback
    }
  }
  instance.element.style.display = '';

  activeShellByProject.set(instance.projectId, instance.id);

  if (!instance.spawned) {
    const project = appState.projects.find(p => p.id === instance.projectId);
    if (project) spawnShell(instance, project.path);
  }
}

function activateAndRefresh(instance: ShellTerminalInstance): void {
  activateShellInstance(instance);
  renderSidebar(instance.projectId);
  requestAnimationFrame(() => {
    fitActiveShell();
    instance.terminal.focus();
  });
}

function showPanel(projectId: string): void {
  const project = appState.projects.find(p => p.id === projectId);
  if (!project) return;

  const list = getShellsFor(projectId);
  if (list.length === 0) {
    createShell(projectId);
  }

  const activeId = activeShellByProject.get(projectId);
  const instance = list.find(s => s.id === activeId) ?? getShellsFor(projectId)[0];

  activateShellInstance(instance);

  panelEl.classList.remove('hidden');
  resizeHandleEl.classList.remove('hidden');

  const height = project.terminalPanelHeight ?? 200;
  panelEl.style.height = `${height}px`;

  currentProjectId = projectId;

  renderSidebar(projectId);

  requestAnimationFrame(() => {
    fitActiveShell();
    fitAllVisible();
    instance.terminal.focus();
  });
}

function hidePanel(): void {
  if (currentProjectId) {
    const instance = getActiveShell(currentProjectId);
    if (instance) hideSearchBar(instance.sessionId);
  }
  panelEl.classList.add('hidden');
  resizeHandleEl.classList.add('hidden');
  requestAnimationFrame(() => fitAllVisible());
}

function getActiveShell(projectId: string): ShellTerminalInstance | undefined {
  const list = shells.get(projectId);
  if (!list || list.length === 0) return undefined;
  const activeId = activeShellByProject.get(projectId);
  return list.find(s => s.id === activeId) ?? list[0];
}

function setActiveShell(projectId: string, shellId: string): void {
  if (activeShellByProject.get(projectId) === shellId) return;
  const list = shells.get(projectId);
  if (!list) return;
  const instance = list.find(s => s.id === shellId);
  if (!instance) return;
  activateAndRefresh(instance);
}

function closeShell(projectId: string, shellId: string): void {
  const list = shells.get(projectId);
  if (!list) return;
  const idx = list.findIndex(s => s.id === shellId);
  if (idx < 0) return;
  const instance = list[idx];

  destroySearchBar(instance.sessionId);
  window.vibeyard.pty.kill(instance.sessionId);
  instance.terminal.dispose();
  instance.element.remove();
  list.splice(idx, 1);

  const wasActive = activeShellByProject.get(projectId) === shellId;

  if (list.length === 0) {
    shells.delete(projectId);
    activeShellByProject.delete(projectId);
    hidePanel();
    appState.setTerminalPanelOpen(false);
    return;
  }

  if (wasActive) {
    const next = list[idx] ?? list[idx - 1] ?? list[0];
    activateShellInstance(next);
  }

  renderSidebar(projectId);
  requestAnimationFrame(() => fitActiveShell());
}

function renderSidebar(projectId: string): void {
  const list = shells.get(projectId) ?? [];
  if (list.length <= 1) {
    sidebarEl.classList.add('hidden');
    sidebarEl.innerHTML = '';
    return;
  }
  sidebarEl.classList.remove('hidden');
  const activeId = activeShellByProject.get(projectId);
  sidebarEl.innerHTML = list.map(s => `
    <div class="terminal-list-item${s.id === activeId ? ' active' : ''}" data-shell-id="${esc(s.id)}">
      <span class="terminal-list-item-name">${esc(s.label)}</span>
      <span class="terminal-list-item-close" title="Close Terminal">&times;</span>
    </div>
  `).join('');

  sidebarEl.querySelectorAll<HTMLElement>('.terminal-list-item').forEach(el => {
    const shellId = el.dataset.shellId!;
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('terminal-list-item-close')) return;
      setActiveShell(projectId, shellId);
    });
    const closeEl = el.querySelector('.terminal-list-item-close');
    if (closeEl) {
      closeEl.addEventListener('click', (e) => {
        e.stopPropagation();
        closeShell(projectId, shellId);
      });
    }
  });
}

function fitActiveShell(): void {
  if (!currentProjectId) return;
  const instance = getActiveShell(currentProjectId);
  if (!instance || panelEl.classList.contains('hidden')) return;
  try {
    instance.fitAddon.fit();
    const { cols, rows } = instance.terminal;
    window.vibeyard.pty.resize(instance.sessionId, cols, rows);
  } catch {
    // not visible yet
  }
}

export function toggleProjectTerminal(): void {
  const project = appState.activeProject;
  if (!project) return;

  const isOpen = !panelEl.classList.contains('hidden') && currentProjectId === project.id;
  if (isOpen) {
    hidePanel();
    appState.setTerminalPanelOpen(false);
  } else {
    showPanel(project.id);
    appState.setTerminalPanelOpen(true);
  }
}

export function handleShellPtyData(sessionId: string, data: string): void {
  const instance = findShellBySessionId(sessionId);
  if (instance) instance.terminal.write(data);
}

export function handleShellPtyExit(sessionId: string, exitCode: number): void {
  const instance = findShellBySessionId(sessionId);
  if (!instance) return;
  instance.spawned = false;

  const overlay = document.createElement('div');
  overlay.className = 'terminal-exit-overlay';
  overlay.innerHTML = `
    <div class="terminal-exit-message">
      <div>Shell exited (code: ${exitCode})</div>
      <button class="respawn-btn">Restart</button>
    </div>
  `;
  overlay.querySelector('.respawn-btn')!.addEventListener('click', () => {
    overlay.remove();
    const project = appState.projects.find(p => p.id === instance.projectId);
    if (project) {
      spawnShell(instance, project.path);
    }
  });
  instance.element.appendChild(overlay);
}

function isShellSessionId(sessionId: string): boolean {
  return sessionId.startsWith('shell-');
}

function destroyAllShells(projectId: string): void {
  const list = shells.get(projectId);
  if (!list) return;
  for (const instance of list) {
    destroySearchBar(instance.sessionId);
    window.vibeyard.pty.kill(instance.sessionId);
    instance.terminal.dispose();
    instance.element.remove();
  }
  shells.delete(projectId);
  activeShellByProject.delete(projectId);
}

export function initProjectTerminal(): void {
  panelEl = document.getElementById('project-terminal-panel')!;
  containerEl = document.getElementById('project-terminal-container')!;
  sidebarEl = document.getElementById('project-terminal-sidebar')!;
  resizeHandleEl = document.getElementById('project-terminal-resize-handle')!;
  const closeBtn = document.getElementById('btn-close-terminal')!;
  const newBtn = document.getElementById('btn-new-terminal')!;
  const toggleBtn = document.getElementById('btn-toggle-terminal')!;

  closeBtn.addEventListener('click', () => {
    hidePanel();
    appState.setTerminalPanelOpen(false);
  });

  newBtn.addEventListener('click', () => {
    const project = appState.activeProject;
    if (!project) return;
    activateAndRefresh(createShell(project.id));
  });

  const primaryKey = displayKeys(shortcutManager.getKeys('project-terminal-alt'));
  toggleBtn.title = `Toggle Terminal (${primaryKey})`;

  toggleBtn.addEventListener('click', () => toggleProjectTerminal());

  // Resize handle drag
  let dragging = false;
  let startY = 0;
  let startHeight = 0;

  resizeHandleEl.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startHeight = panelEl.offsetHeight;
    resizeHandleEl.classList.add('active');
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging) return;
      const delta = startY - ev.clientY;
      const newHeight = Math.max(80, Math.min(startHeight + delta, window.innerHeight - 150));
      panelEl.style.height = `${newHeight}px`;
      fitActiveShell();
      fitAllVisible();
    };

    const onMouseUp = () => {
      dragging = false;
      resizeHandleEl.classList.remove('active');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      const height = panelEl.offsetHeight;
      appState.setTerminalPanelHeight(height);
      fitActiveShell();
      fitAllVisible();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // React to project changes
  appState.on('project-changed', () => {
    const project = appState.activeProject;
    if (!project) {
      hidePanel();
      currentProjectId = null;
      return;
    }

    if (project.terminalPanelOpen) {
      showPanel(project.id);
    } else {
      hidePanel();
      currentProjectId = project.id;
    }
  });

  // On state load, restore panel for active project
  appState.on('state-loaded', () => {
    const project = appState.activeProject;
    if (project?.terminalPanelOpen) {
      showPanel(project.id);
    }
  });

  // Clean up when project is removed
  appState.on('project-removed', (data) => {
    const projectId = data as string;
    destroyAllShells(projectId);
    if (currentProjectId === projectId) {
      hidePanel();
      currentProjectId = null;
    }
  });

  // Resize terminal when window resizes
  resizeObserver = new ResizeObserver(() => {
    if (currentProjectId && !panelEl.classList.contains('hidden')) {
      fitActiveShell();
    }
  });
  resizeObserver.observe(containerEl);
}

export function getShellTerminalInstance(sessionId: string): ShellTerminalInstance | undefined {
  return findShellBySessionId(sessionId);
}

export function getActiveShellSessionId(): string | null {
  if (!currentProjectId || panelEl.classList.contains('hidden')) return null;
  const instance = getActiveShell(currentProjectId);
  return instance?.sessionId ?? null;
}

export { isShellSessionId };
