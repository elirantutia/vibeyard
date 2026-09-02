import { Terminal } from '@xterm/xterm';
import { getTerminalTheme } from '../terminal-theme.js';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { initSession, removeSession } from '../session-activity.js';
import { markFreshSession } from '../session-insights.js';
import { removeSession as removeCostSession, formatTokens, getCost, type CostInfo } from '../session-cost.js';
import { removeSession as removeContextSession, getContext, getContextSeverity, type ContextWindowInfo } from '../session-context.js';
import type { ProviderId } from '../types.js';
import { getProviderCapabilities } from '../provider-availability.js';
import { appState } from '../state.js';
import { FilePathLinkProvider, GithubLinkProvider } from './terminal-link-provider.js';
import { attachClipboardCopyHandler, attachCopyOnSelect, collapseArmedTextareaOnContextMenu, loadWebglWithFallback, wrapBracketedPaste } from './terminal-utils.js';
import { FILE_PATH_DRAG_TYPE, NATIVE_FILES_DRAG_TYPE } from '../drag-types.js';
import { showTerminalContextMenu } from './terminal-context-menu.js';

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
  envVars: string;
  /** Resolved profile config dir (CLAUDE_CONFIG_DIR), or undefined for the default ~/.claude. */
  configDir?: string;
  isResume: boolean;
  wasResumed: boolean;
  spawned: boolean;
  exited: boolean;
  pendingPrompt: string | null;
  pendingSystemPrompt: string | null;
  pendingPromptTimer: ReturnType<typeof setTimeout> | null;
  /** `cols`x`rows` last sent to the PTY, so a no-op fit doesn't make the CLI redraw. */
  lastSize: string | null;
  /**
   * Peak output-token count seen this session, used to render a stable "out"
   * figure. Claude's `context_window.total_output_tokens` is per-turn, not
   * cumulative — it ramps up while a response streams (2 → … → final) and
   * resets low at each new turn. Holding the peak keeps the rail from
   * flickering down to a tiny number on every turn boundary.
   */
  peakOutputTokens: number;
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
  projectId?: string,
  envVars: string = '',
  configDir?: string
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
  const caps = getProviderCapabilities(providerId);
  // The `$0.0000` placeholder is painted below by updateCostDisplay, which owns this
  // node's DOM — the two must not render the profile label differently.
  costDisplay.classList.toggle('hidden', caps?.costTracking === false);
  contextIndicator.classList.toggle('hidden', caps?.contextWindow === false);
  statusBar.appendChild(contextIndicator);
  statusBar.appendChild(costDisplay);
  element.appendChild(statusBar);

  const terminal = new Terminal({
    theme: getTerminalTheme(appState.preferences.theme ?? 'dark'),
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, monospace",
    cursorBlink: true,
    allowProposedApi: true,
    linkHandler: {
      activate: (event, uri) => {
        if (event.metaKey || event.ctrlKey) {
          window.vibeyard.app.openExternal(uri);
        }
      },
    },
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);

  const searchAddon = new SearchAddon();
  terminal.loadAddon(searchAddon);

  terminal.loadAddon(new WebLinksAddon((event, url) => {
    if (event.metaKey || event.ctrlKey) {
      window.vibeyard.app.openExternal(url);
    }
  }));

  const writeToPty = (data: string) => window.vibeyard.pty.write(sessionId, data);

  // Send CSI u encoding for Shift+Enter so Claude CLI treats it as newline
  attachClipboardCopyHandler(terminal, (e) => {
    if (e.shiftKey && e.key === 'Enter') {
      if (e.type === 'keydown') window.vibeyard.pty.write(sessionId, '\x1b[13;2u');
      e.preventDefault();
      return false;
    }
  }, writeToPty);

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
    envVars,
    configDir,
    isResume,
    wasResumed: isResume,
    spawned: false,
    exited: false,
    pendingPrompt: null,
    pendingSystemPrompt: null,
    pendingPromptTimer: null,
    lastSize: null,
    peakOutputTokens: 0,
  };

  instances.set(sessionId, instance);

  // Paint the rail. A store with a silent `restore*` seeder has to be *pulled* by any
  // consumer that builds its DOM lazily — a push-only consumer is only correct if its DOM
  // provably predates every event, and this one does not. Without the pull a resumed
  // session keeps an empty (CSS `:empty` → hidden) meter indefinitely: `setContextData`
  // dedupes on identical values and a resume reports exactly what was persisted at quit,
  // so `onContextChange` never fires. Cost would self-heal on its own (its dedupe includes
  // the ticking duration), but goes through the same call so `updateCostDisplay` stays the
  // single renderer of this node — it paints the `$0.0000` placeholder when cost is null.
  updateCostDisplay(sessionId, getCost(sessionId));
  const restoredContext = getContext(sessionId);
  if (restoredContext) updateContextDisplay(sessionId, restoredContext);

  // Register file path link provider for Cmd+Click
  if (projectId) {
    terminal.registerLinkProvider(new FilePathLinkProvider(projectId, projectPath, terminal));
  }

  // Register GitHub #123 link provider
  window.vibeyard.git.getRemoteUrl(projectPath).then((repoUrl) => {
    if (repoUrl) {
      terminal.registerLinkProvider(new GithubLinkProvider(repoUrl, terminal));
    }
  });

  // Handle user input → PTY
  terminal.onData((data) => {
    window.vibeyard.pty.write(sessionId, data);
  });

  // Focus tracking
  element.addEventListener('mousedown', () => {
    setFocused(sessionId);
  });
  // Use onKey (real keystrokes only), NOT onData: onData also fires for
  // terminal-generated responses to query escape sequences (e.g. cursor-position
  // reports under CLAUDE_CODE_NO_FLICKER=1), which would otherwise steal focus
  // back to the terminal on every frame.
  terminal.onKey(() => {
    if (focusedSessionId !== sessionId) {
      setFocused(sessionId);
    }
  });

  element.addEventListener('dragover', (e: DragEvent) => {
    if (!e.dataTransfer) return;
    const types = e.dataTransfer.types;
    if (!types.includes(FILE_PATH_DRAG_TYPE) && !types.includes(NATIVE_FILES_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    element.classList.add('drag-over');
  });
  element.addEventListener('dragleave', (e: DragEvent) => {
    const next = e.relatedTarget as Node | null;
    if (!next || !element.contains(next)) {
      element.classList.remove('drag-over');
    }
  });
  element.addEventListener('drop', (e: DragEvent) => {
    element.classList.remove('drag-over');
    const paths = collectDroppedPaths(e.dataTransfer);
    if (paths.length === 0) return;
    e.preventDefault();
    if (injectTextIntoRunningSession(sessionId, paths.join(' ') + ' ')) {
      terminal.focus();
    }
  });

  xtermWrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTerminalContextMenu(e.clientX, e.clientY, terminal, writeToPty);
  });

  return instance;
}

export function getTerminalInstance(sessionId: string): TerminalInstance | undefined {
  return instances.get(sessionId);
}

export function getAllInstances(): Map<string, TerminalInstance> {
  return instances;
}

export function applyThemeToAllTerminals(theme: 'dark' | 'light'): void {
  const termTheme = getTerminalTheme(theme);
  for (const instance of instances.values()) {
    instance.terminal.options.theme = termTheme;
  }
}

export function setPendingPrompt(sessionId: string, prompt: string): void {
  const instance = instances.get(sessionId);
  if (instance) {
    instance.pendingPrompt = prompt;
  }
}

export function setPendingSystemPrompt(sessionId: string, prompt: string): void {
  const instance = instances.get(sessionId);
  if (instance) {
    instance.pendingSystemPrompt = prompt;
  }
}

function collectDroppedPaths(dt: DataTransfer | null): string[] {
  if (!dt) return [];
  const internal = dt.getData(FILE_PATH_DRAG_TYPE);
  if (internal) return [internal];
  const paths: string[] = [];
  for (const file of dt.files) {
    const path = window.vibeyard.fs.getDroppedFilePath(file);
    if (path) paths.push(path);
  }
  return paths;
}

export function injectTextIntoRunningSession(sessionId: string, text: string): boolean {
  const instance = instances.get(sessionId);
  if (!instance || !instance.spawned || instance.exited) return false;
  window.vibeyard.pty.write(sessionId, wrapBracketedPaste(instance.terminal, text));
  return true;
}

export function injectPromptIntoRunningSession(sessionId: string, prompt: string): boolean {
  if (!injectTextIntoRunningSession(sessionId, prompt)) return false;
  window.vibeyard.pty.write(sessionId, '\r');
  return true;
}

function clearPendingPromptTimer(instance: TerminalInstance): void {
  if (instance.pendingPromptTimer) {
    clearTimeout(instance.pendingPromptTimer);
    instance.pendingPromptTimer = null;
  }
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
  let initialPrompt: string | undefined;
  if (instance.pendingPrompt && getProviderCapabilities(instance.providerId)?.pendingPromptTrigger === 'startup-arg') {
    initialPrompt = instance.pendingPrompt;
    instance.pendingPrompt = null;
  }
  let systemPrompt: string | undefined;
  if (instance.pendingSystemPrompt) {
    systemPrompt = instance.pendingSystemPrompt;
    instance.pendingSystemPrompt = null;
  }
  await window.vibeyard.pty.create(sessionId, instance.projectPath, instance.cliSessionId, instance.isResume, instance.args, instance.providerId, initialPrompt, systemPrompt, instance.envVars, instance.configDir);
  instance.isResume = true; // subsequent spawns (e.g. Restart Session) should resume

  // Callers fire this un-awaited and fit the pane immediately after, so that fit
  // can reach the main process while `pty:create` is still suspended (Copilot
  // awaits a hook install before registering the PTY) — `resizePty` drops a
  // resize for a session it has never heard of. The PTY also starts at the
  // hardcoded spawn default, not at whatever the previous one was sized to. So
  // forget the memo and re-fit now that a PTY definitely exists.
  instance.lastSize = null;
  fitTerminal(sessionId);
}

/**
 * Put a pane in `container`, opening xterm into it on first attach.
 *
 * Idempotent by design: a pane already in `container` is left alone, because
 * `appendChild` on a node that is already a child removes and re-inserts it —
 * which blurs whatever is focused inside (the Cmd+F find bar lives in the pane,
 * see `search-bar.ts`) and collapses an in-progress selection. `renderLayout()`
 * runs on every `session-changed`, so a render that changed nothing must touch
 * nothing. DOM order among the panes laid out together is corrected separately,
 * by `ensurePaneOrder` in `split-layout.ts`.
 */
export function attachToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;

  const xtermWrap = instance.element.querySelector('.xterm-wrap')!;
  if (!xtermWrap.querySelector('.xterm')) {
    container.appendChild(instance.element);
    instance.terminal.open(xtermWrap as HTMLElement);

    attachCopyOnSelect(instance.terminal);
    collapseArmedTextareaOnContextMenu(instance.terminal);
    loadWebglWithFallback(instance.terminal);
  } else if (instance.element.parentElement !== container) {
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
    instance.element.classList.remove('swarm-dimmed', 'swarm-unread');
  }
}

export function fitTerminal(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance || instance.element.classList.contains('hidden')) return;

  try {
    instance.fitAddon.fit();
    const { cols, rows } = instance.terminal;
    // renderLayout() ends in a fitAllVisible(), and a redundant resize makes the
    // CLI redraw underneath an in-progress selection.
    const size = `${cols}x${rows}`;
    if (size === instance.lastSize) return;
    instance.lastSize = size;
    window.vibeyard.pty.resize(sessionId, cols, rows);
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

  // Only move DOM focus if it's currently on a session terminal (or nothing).
  // This prevents stealing focus from the project terminal panel, modals, etc.
  //
  // It deliberately does NOT try to spare the Cmd+F find bar, which lives *inside*
  // the pane (search-bar.ts) and so is indistinguishable from the terminal here.
  // That is `focusPane` in split-layout.ts's job: a render the user didn't ask for
  // never reaches this function at all.
  const activeEl = document.activeElement;
  const shouldFocusTerminal =
    !activeEl ||
    activeEl === document.body ||
    !!activeEl.closest('.terminal-pane');

  for (const [id, instance] of instances) {
    if (id === sessionId) {
      instance.element.classList.add('focused');
      if (shouldFocusTerminal) {
        instance.terminal.focus();
      }
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

  clearPendingPromptTimer(instance);
  window.vibeyard.pty.kill(sessionId);
  instance.terminal.dispose();
  instance.element.remove();
  instances.delete(sessionId);
  removeSession(sessionId);
  removeCostSession(sessionId);
  removeContextSession(sessionId);
}

function showStatusBar(instance: TerminalInstance): void {
  const bar = instance.element.querySelector('.session-status-bar');
  if (bar) bar.classList.remove('hidden');
}

/**
 * Display name of the profile backing this session, or null when there is only a single
 * (implicit) profile for the provider and the label would be noise. Keyed off the
 * session's `configDir` — the exact dir threaded into the PTY spawn — so the label can
 * never disagree with the config the running session actually uses. No matching dir
 * (undefined → base ~/.claude) is labeled "Default".
 */
function resolveProfileName(providerId: ProviderId, configDir?: string): string | null {
  const providerProfiles = appState.profiles.filter((p) => p.providerId === providerId);
  if (providerProfiles.length <= 1) return null;
  const profile = configDir ? providerProfiles.find((p) => p.configDir === configDir) : undefined;
  return profile?.name ?? 'Default';
}

/** Re-render every open pane's cost line from its last known cost (e.g. after a profile is added/removed). */
export function refreshProfileLabels(): void {
  for (const instance of instances.values()) {
    if (getProviderCapabilities(instance.providerId)?.costTracking === false) continue;
    updateCostDisplay(instance.sessionId, getCost(instance.sessionId));
  }
}

export function updateCostDisplay(sessionId: string, cost: CostInfo | null): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (getProviderCapabilities(instance.providerId)?.costTracking === false) return;
  const el = instance.element.querySelector('.cost-display') as HTMLElement | null;
  if (!el) return;

  // Rebuild the rail's right cluster: [profile pill] · [model] · [cost] | [in/out].
  // Separators are only inserted between segments that are actually present.
  el.replaceChildren();
  const segs: HTMLElement[] = [];

  const profileName = resolveProfileName(instance.providerId, instance.configDir);
  if (profileName) {
    const pill = document.createElement('span');
    pill.className = 'ssl-pill';
    pill.textContent = profileName;
    segs.push(pill);
  }
  if (cost?.model) {
    const model = document.createElement('span');
    model.className = 'ssl-model seg';
    model.textContent = cost.model;
    segs.push(model);
  }
  const costEl = document.createElement('span');
  costEl.className = 'ssl-cost seg';
  costEl.textContent = `$${(cost?.totalCostUsd ?? 0).toFixed(4)}`;
  segs.push(costEl);

  segs.forEach((seg, i) => {
    if (i > 0) {
      const dot = document.createElement('span');
      dot.className = 'ssl-dot';
      dot.textContent = '·';
      el.appendChild(dot);
    }
    el.appendChild(seg);
  });

  // `total_output_tokens` is per-turn and regresses at each turn boundary;
  // hold the session peak so the displayed "out" only ever ratchets up.
  if (cost) instance.peakOutputTokens = Math.max(instance.peakOutputTokens, cost.totalOutputTokens);
  const outTokens = instance.peakOutputTokens;

  if (cost && (cost.totalInputTokens > 0 || outTokens > 0)) {
    const vrule = document.createElement('span');
    vrule.className = 'ssl-vrule';
    el.appendChild(vrule);
    const io = document.createElement('span');
    io.className = 'ssl-io seg';
    io.textContent = `${formatTokens(cost.totalInputTokens)} in / ${formatTokens(outTokens)} out`;
    el.appendChild(io);

    const durationSec = (cost.totalDurationMs / 1000).toFixed(1);
    const apiDurationSec = (cost.totalApiDurationMs / 1000).toFixed(1);
    el.title = `Cache read: ${formatTokens(cost.cacheReadTokens)} · Cache create: ${formatTokens(cost.cacheCreationTokens)} · Duration: ${durationSec}s · API: ${apiDurationSec}s`;
  } else {
    el.title = '';
  }
  showStatusBar(instance);
}

export function updateContextDisplay(sessionId: string, info: ContextWindowInfo): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (getProviderCapabilities(instance.providerId)?.contextWindow === false) return;
  const el = instance.element.querySelector('.context-indicator') as HTMLElement | null;
  if (!el) return;

  // Lazily build the rail's left cluster once (graphical meter + % + tokens),
  // then update values in place so the meter width can transition smoothly.
  let fill = el.querySelector('.ssl-meter-fill') as HTMLElement | null;
  if (!fill) {
    el.replaceChildren();
    const label = document.createElement('span');
    label.className = 'ssl-label';
    label.textContent = 'Context';
    const meter = document.createElement('div');
    meter.className = 'ssl-meter';
    fill = document.createElement('div');
    fill.className = 'ssl-meter-fill';
    meter.appendChild(fill);
    const pctEl = document.createElement('span');
    pctEl.className = 'ssl-pct';
    const tokEl = document.createElement('span');
    tokEl.className = 'ssl-tok';
    el.append(label, meter, pctEl, tokEl);
  }

  const pct = Math.min(Math.round(info.usedPercentage), 100);
  fill.style.width = `${pct}%`;
  (el.querySelector('.ssl-pct') as HTMLElement).textContent = `${pct}%`;
  (el.querySelector('.ssl-tok') as HTMLElement).textContent = formatTokens(info.totalTokens);
  el.title = `${info.totalTokens.toLocaleString()} / ${info.contextWindowSize.toLocaleString()} tokens`;

  // Context-fill state drives the meter hue (iris → amber → red) on the whole bar.
  const severity = getContextSeverity(pct);
  const state = severity === 'critical' ? 'crit' : severity === 'warning' ? 'warn' : 'ok';
  const bar = instance.element.querySelector('.session-status-bar') as HTMLElement | null;
  if (bar) bar.dataset.state = state;

  showStatusBar(instance);
}
