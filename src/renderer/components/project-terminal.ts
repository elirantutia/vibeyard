import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { appState } from '../state.js';
import { fitAllVisible } from './terminal-pane.js';
import { destroySearchBar, hideSearchBar } from './search-bar.js';
import { shortcutManager, displayKeys } from '../shortcuts.js';
import { attachClipboardCopyHandler } from './terminal-utils.js';

interface ShellTerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement;
  projectId: string;
  sessionId: string;
  spawned: boolean;
}

const shells = new Map<string, ShellTerminalInstance>();

let panelEl: HTMLElement;
let containerEl: HTMLElement;
let resizeHandleEl: HTMLElement;
let currentProjectId: string | null = null;
let resizeObserver: ResizeObserver | null = null;

function shellSessionId(projectId: string): string {
  return `shell-${projectId}`;
}

function ensureShell(projectId: string, projectPath: string): ShellTerminalInstance {
  if (shells.has(projectId)) {
    return shells.get(projectId)!;
  }

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

  attachClipboardCopyHandler(terminal);

  const sessionId = shellSessionId(projectId);

  const instance: ShellTerminalInstance = {
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

  shells.set(projectId, instance);
  return instance;
}

async function spawnShell(instance: ShellTerminalInstance, projectPath: string): Promise<void> {
  if (instance.spawned) return;
  instance.spawned = true;

  // Remove any exit overlay
  const overlay = instance.element.querySelector('.terminal-exit-overlay');
  if (overlay) overlay.remove();

  await window.vibeyard.pty.createShell(instance.sessionId, projectPath);
}

function showPanel(projectId: string): void {
  const project = appState.projects.find(p => p.id === projectId);
  if (!project) return;

  const instance = ensureShell(projectId, project.path);

  // Hide other shell elements
  for (const [pid, shell] of shells) {
    if (pid !== projectId) {
      shell.element.style.display = 'none';
    }
  }

  // Attach and open if needed
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

  panelEl.classList.remove('hidden');
  resizeHandleEl.classList.remove('hidden');

  // Restore persisted height
  const height = project.terminalPanelHeight ?? 200;
  panelEl.style.height = `${height}px`;

  currentProjectId = projectId;

  // Spawn PTY if first time
  if (!instance.spawned) {
    spawnShell(instance, project.path);
  }

  // Fit after visible
  requestAnimationFrame(() => {
    fitShellTerminal(projectId);
    fitAllVisible();
    instance.terminal.focus();
  });
}

function hidePanel(): void {
  if (currentProjectId) {
    const instance = shells.get(currentProjectId);
    if (instance) hideSearchBar(instance.sessionId);
  }
  panelEl.classList.add('hidden');
  resizeHandleEl.classList.add('hidden');
  requestAnimationFrame(() => fitAllVisible());
}

function fitShellTerminal(projectId: string): void {
  const instance = shells.get(projectId);
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
  // Find by sessionId prefix
  for (const [, instance] of shells) {
    if (instance.sessionId === sessionId) {
      instance.terminal.write(data);
      return;
    }
  }
}

export function handleShellPtyExit(sessionId: string, exitCode: number): void {
  for (const [, instance] of shells) {
    if (instance.sessionId === sessionId) {
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
      return;
    }
  }
}

function isShellSessionId(sessionId: string): boolean {
  return sessionId.startsWith('shell-');
}

function destroyShell(projectId: string): void {
  const instance = shells.get(projectId);
  if (!instance) return;
  destroySearchBar(instance.sessionId);
  window.vibeyard.pty.kill(instance.sessionId);
  instance.terminal.dispose();
  instance.element.remove();
  shells.delete(projectId);
}

export function initProjectTerminal(): void {
  panelEl = document.getElementById('project-terminal-panel')!;
  containerEl = document.getElementById('project-terminal-container')!;
  resizeHandleEl = document.getElementById('project-terminal-resize-handle')!;
  const closeBtn = document.getElementById('btn-close-terminal')!;
  const toggleBtn = document.getElementById('btn-toggle-terminal')!;

  closeBtn.addEventListener('click', () => {
    hidePanel();
    appState.setTerminalPanelOpen(false);
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
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY;
    const newHeight = Math.max(80, Math.min(startHeight + delta, window.innerHeight - 150));
    panelEl.style.height = `${newHeight}px`;
    if (currentProjectId) {
      fitShellTerminal(currentProjectId);
    }
    fitAllVisible();
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizeHandleEl.classList.remove('active');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    // Persist height
    const height = panelEl.offsetHeight;
    appState.setTerminalPanelHeight(height);
    if (currentProjectId) {
      fitShellTerminal(currentProjectId);
    }
    fitAllVisible();
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
    destroyShell(projectId);
    if (currentProjectId === projectId) {
      hidePanel();
      currentProjectId = null;
    }
  });

  // Resize terminal when window resizes
  resizeObserver = new ResizeObserver(() => {
    if (currentProjectId && !panelEl.classList.contains('hidden')) {
      fitShellTerminal(currentProjectId);
    }
  });
  resizeObserver.observe(containerEl);
}

export function getShellTerminalInstance(sessionId: string): ShellTerminalInstance | undefined {
  const projectId = sessionId.replace('shell-', '');
  return shells.get(projectId);
}

export function getActiveShellSessionId(): string | null {
  if (!currentProjectId || panelEl.classList.contains('hidden')) return null;
  const instance = shells.get(currentProjectId);
  return instance?.sessionId ?? null;
}

export { isShellSessionId };
