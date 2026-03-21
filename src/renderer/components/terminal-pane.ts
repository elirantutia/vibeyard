import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { initSession, removeSession } from '../session-activity.js';
import { markFreshSession } from '../session-insights.js';
import { removeSession as removeCostSession, type CostInfo } from '../session-cost.js';
import { removeSession as removeContextSession, type ContextWindowInfo } from '../session-context.js';
import type { ProviderId } from '../types.js';
import { FilePathLinkProvider } from './terminal-link-provider.js';

interface TerminalInstance {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement;
  sessionId: string;
  projectPath: string;
  cliSessionId: string | null;
  providerId: ProviderId;
  args: string;
  isResume: boolean;
  spawned: boolean;
  exited: boolean;
}

const instances = new Map<string, TerminalInstance>();
let focusedSessionId: string | null = null;

export function createTerminalPane(
  sessionId: string,
  projectPath: string,
  cliSessionId: string | null,
  isResume: boolean = false,
  args: string = '',
  providerId: ProviderId = 'claude',
  projectId?: string
): TerminalInstance {
  if (instances.has(sessionId)) {
    return instances.get(sessionId)!;
  }

  const element = document.createElement('div');
  element.className = 'terminal-pane hidden';
  element.dataset.sessionId = sessionId;

  const xtermWrap = document.createElement('div');
  xtermWrap.className = 'xterm-wrap';
  element.appendChild(xtermWrap);

  const statusBar = document.createElement('div');
  statusBar.className = 'session-status-bar';
  const contextIndicator = document.createElement('div');
  contextIndicator.className = 'context-indicator';
  const costDisplay = document.createElement('div');
  costDisplay.className = 'cost-display';
  costDisplay.textContent = '$0.0000';
  statusBar.appendChild(contextIndicator);
  statusBar.appendChild(costDisplay);
  element.appendChild(statusBar);

  const terminal = new Terminal({
    theme: {
      background: '#000000',
      foreground: '#e0e0e0',
      cursor: '#e94560',
      selectionBackground: '#e9456040',
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

  // Let Cmd+F bubble up to the document listener instead of being consumed by xterm
  terminal.attachCustomKeyEventHandler((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      return false;
    }
    // Send CSI u encoding for Shift+Enter so Claude CLI treats it as newline
    if (e.shiftKey && e.key === 'Enter') {
      if (e.type === 'keydown') {
        window.claudeIde.pty.write(sessionId, '\x1b[13;2u');
      }
      e.preventDefault();
      return false;
    }
    return true;
  });

  const instance: TerminalInstance = {
    terminal,
    fitAddon,
    searchAddon,
    element,
    sessionId,
    projectPath,
    cliSessionId,
    providerId,
    args,
    isResume,
    spawned: false,
    exited: false,
  };

  instances.set(sessionId, instance);

  // Register file path link provider for Cmd+Click
  if (projectId) {
    terminal.registerLinkProvider(new FilePathLinkProvider(projectId, projectPath, terminal));
  }

  // Handle user input → PTY
  terminal.onData((data) => {
    window.claudeIde.pty.write(sessionId, data);
  });

  // Focus tracking
  element.addEventListener('mousedown', () => {
    setFocused(sessionId);
  });
  terminal.onData(() => {
    if (focusedSessionId !== sessionId) {
      setFocused(sessionId);
    }
  });

  return instance;
}

export function getTerminalInstance(sessionId: string): TerminalInstance | undefined {
  return instances.get(sessionId);
}

export function getAllInstances(): Map<string, TerminalInstance> {
  return instances;
}

export async function spawnTerminal(sessionId: string): Promise<void> {
  const instance = instances.get(sessionId);
  if (!instance || instance.spawned) return;

  instance.spawned = true;
  instance.exited = false;

  // Remove any exit overlay
  const overlay = instance.element.querySelector('.terminal-exit-overlay');
  if (overlay) overlay.remove();

  if (!instance.isResume) {
    markFreshSession(sessionId);
  }
  initSession(sessionId);
  await window.claudeIde.pty.create(sessionId, instance.projectPath, instance.cliSessionId, instance.isResume, instance.args, instance.providerId);
  instance.isResume = true; // subsequent spawns (e.g. Restart Session) should resume
}

export function attachToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  const xtermWrap = instance.element.querySelector('.xterm-wrap')!;
  if (!xtermWrap.querySelector('.xterm')) {
    container.appendChild(instance.element);
    instance.terminal.open(xtermWrap as HTMLElement);

    // Try WebGL, fall back silently
    try {
      const webglAddon = new WebglAddon();
      instance.terminal.loadAddon(webglAddon);
    } catch {
      // WebGL not available, software renderer works fine
    }
  } else if (!container.contains(instance.element)) {
    container.appendChild(instance.element);
  }
}

export function showPane(sessionId: string, split: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  if (split) {
    instance.element.classList.add('split');
  } else {
    instance.element.classList.remove('split');
  }
}

export function hidePane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.add('hidden');
}

export function hideAllPanes(): void {
  for (const [, instance] of instances) {
    instance.element.classList.add('hidden');
  }
}

export function fitTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance || instance.element.classList.contains('hidden')) return;

  try {
    instance.fitAddon.fit();
    const { cols, rows } = instance.terminal;
    window.claudeIde.pty.resize(sessionId, cols, rows);
  } catch {
    // Element not yet visible
  }
}

export function fitAllVisible(): void {
  for (const [sessionId, instance] of instances) {
    if (!instance.element.classList.contains('hidden')) {
      fitTerminal(sessionId);
    }
  }
}

export function getSearchAddon(sessionId: string): SearchAddon | undefined {
  return instances.get(sessionId)?.searchAddon;
}

export function getFocusedSessionId(): string | null {
  return focusedSessionId;
}

export function setFocused(sessionId: string): void {
  focusedSessionId = sessionId;
  for (const [id, instance] of instances) {
    if (id === sessionId) {
      instance.element.classList.add('focused');
      instance.terminal.focus();
    } else {
      instance.element.classList.remove('focused');
    }
  }
}

export function handlePtyData(sessionId: string, data: string): void {
  const instance = instances.get(sessionId);
  if (instance) {
    instance.terminal.write(data);
  }
}

export function destroyTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  window.claudeIde.pty.kill(sessionId);
  instance.terminal.dispose();
  instance.element.remove();
  instances.delete(sessionId);
  removeSession(sessionId);
  removeCostSession(sessionId);
  removeContextSession(sessionId);
}

function formatTokens(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

function showStatusBar(instance: TerminalInstance): void {
  const bar = instance.element.querySelector('.session-status-bar');
  if (bar) bar.classList.remove('hidden');
}

export function updateCostDisplay(sessionId: string, cost: CostInfo): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  const el = instance.element.querySelector('.cost-display');
  if (!el) return;

  const costStr = `$${cost.totalCostUsd.toFixed(4)}`;
  if (cost.totalInputTokens > 0 || cost.totalOutputTokens > 0) {
    el.textContent = `${costStr}  \u00b7  ${formatTokens(cost.totalInputTokens)} in / ${formatTokens(cost.totalOutputTokens)} out`;
    const durationSec = (cost.totalDurationMs / 1000).toFixed(1);
    const apiDurationSec = (cost.totalApiDurationMs / 1000).toFixed(1);
    (el as HTMLElement).title = `Cache read: ${formatTokens(cost.cacheReadTokens)} · Cache create: ${formatTokens(cost.cacheCreationTokens)} · Duration: ${durationSec}s · API: ${apiDurationSec}s`;
  } else {
    el.textContent = `${costStr}`;
    (el as HTMLElement).title = '';
  }
  showStatusBar(instance);
}

export function updateContextDisplay(sessionId: string, info: ContextWindowInfo): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  const el = instance.element.querySelector('.context-indicator') as HTMLElement | null;
  if (!el) return;

  const pct = Math.min(Math.round(info.usedPercentage), 100);
  const filledCount = Math.round(pct / 10);
  const emptyCount = 10 - filledCount;
  const bar = '=' .repeat(filledCount) + '-'.repeat(emptyCount);
  const tokenStr = formatTokens(info.totalTokens);

  el.textContent = `[${bar}] ${pct}% ${tokenStr} tokens`;
  el.title = `${info.totalTokens.toLocaleString()} / ${info.contextWindowSize.toLocaleString()} tokens`;

  el.classList.remove('warning', 'critical');
  if (pct >= 90) {
    el.classList.add('critical');
  } else if (pct >= 70) {
    el.classList.add('warning');
  }

  showStatusBar(instance);
}
