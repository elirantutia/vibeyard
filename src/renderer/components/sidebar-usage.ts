import { appState } from '../state.js';
import { onChange as onCostChange, getCost } from '../session-cost.js';
import type { CostInfo } from '../session-cost.js';
import type { BlockInfo } from '../../shared/types';

// All current Anthropic models (Sonnet/Opus/Haiku 4.x) ship with a 200K window.
// Update this table if a future model variant ships with a different default.
const CONTEXT_LIMIT_DEFAULT = 200_000;
const CONTEXT_LIMIT_OPUS_1M = 1_000_000;

let containerEl: HTMLElement | null = null;
let labelNameEl: HTMLElement | null = null;
let pctEl: HTMLElement | null = null;
let barEl: HTMLElement | null = null;
let fillEl: HTMLElement | null = null;
let blockRowEl: HTMLElement | null = null;
let unsubscribeCost: (() => void) | null = null;
let unsubscribeBlock: (() => void) | null = null;
let countdownTickerId: number | null = null;
let clickHandler: ((e: Event) => void) | null = null;
let clickHandlerEl: HTMLElement | null = null;
const appStateUnsubscribers: Array<() => void> = [];
let currentBlock: BlockInfo | null = null;
const COUNTDOWN_TICKER_MS = 60_000;

export function getContextWindowLimit(model: string | undefined): number {
  if (!model) return CONTEXT_LIMIT_DEFAULT;
  const m = model.toLowerCase();
  if (m.includes('[1m]') || m.includes('-1m')) return CONTEXT_LIMIT_OPUS_1M;
  return CONTEXT_LIMIT_DEFAULT;
}

// Output tokens are intentionally excluded — they roll into `totalInputTokens`
// on the next turn, so counting both would double-count.
export function computeUsedTokens(cost: CostInfo): number {
  return cost.totalInputTokens + cost.cacheReadTokens + cost.cacheCreationTokens;
}

export function prettyModel(raw: string | undefined): string {
  if (!raw) return '';
  // Claude Code's status line may already provide a friendly display_name like
  // "Opus 4.7 (1M context)". If it already contains a space and an uppercase
  // letter, treat it as already formatted and pass through.
  if (/\s/.test(raw) && /[A-Z]/.test(raw)) return raw;
  let model = raw;
  let oneM = false;
  if (/\[1m\]$/.test(model) || /-1m$/i.test(model)) {
    oneM = true;
    model = model.replace(/\[1m\]$/, '').replace(/-1m$/i, '');
  }
  const stripped = model.replace(/^claude-/, '').replace(/-\d{8,}$/, '');
  const parts = stripped.split('-');
  const family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const version = parts.slice(1).join('.');
  const base = version ? `${family} ${version}` : family;
  return oneM ? `${base} (1M)` : base;
}

export function formatCountdown(resetsAt: number, now: number): string {
  const remaining = Math.max(0, resetsAt - now);
  const totalMinutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h${minutes.toString().padStart(2, '0')}m`;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function buildDom(host: HTMLElement): void {
  host.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'sidebar-usage-label';

  labelNameEl = document.createElement('span');
  labelNameEl.className = 'sidebar-usage-name';
  labelNameEl.textContent = 'Context';

  pctEl = document.createElement('span');
  pctEl.className = 'sidebar-usage-pct';
  pctEl.textContent = '0%';

  label.appendChild(labelNameEl);
  label.appendChild(pctEl);

  barEl = document.createElement('div');
  barEl.className = 'sidebar-usage-bar';
  barEl.setAttribute('role', 'progressbar');
  barEl.setAttribute('aria-valuemin', '0');
  barEl.setAttribute('aria-valuemax', '100');
  barEl.setAttribute('aria-valuenow', '0');
  barEl.setAttribute('aria-label', 'Context window usage');

  fillEl = document.createElement('div');
  fillEl.className = 'sidebar-usage-fill sidebar-usage-normal';
  fillEl.style.width = '0%';

  barEl.appendChild(fillEl);
  host.appendChild(label);
  host.appendChild(barEl);

  blockRowEl = document.createElement('div');
  blockRowEl.className = 'sidebar-usage-block hidden';
  host.appendChild(blockRowEl);
}

export function initSidebarUsage(): void {
  containerEl = document.getElementById('sidebar-usage');
  if (!containerEl) return;
  buildDom(containerEl);

  if (clickHandler && clickHandlerEl) {
    clickHandlerEl.removeEventListener('click', clickHandler);
  }
  clickHandler = () => {
    void window.vibeyard.usage.refresh().catch((err) => {
      console.warn('[sidebar-usage] refresh failed', err);
    });
  };
  clickHandlerEl = containerEl;
  containerEl.addEventListener('click', clickHandler);

  if (appStateUnsubscribers.length === 0) {
    appStateUnsubscribers.push(
      appState.on('state-loaded', render),
      appState.on('session-changed', render),
      appState.on('project-changed', render),
      appState.on('preferences-changed', render),
    );
  }

  if (unsubscribeCost) unsubscribeCost();
  unsubscribeCost = onCostChange(() => render());

  if (unsubscribeBlock) unsubscribeBlock();
  window.vibeyard.usage
    .getBlock()
    .then((info) => {
      currentBlock = info;
      render();
    })
    .catch(() => {});
  unsubscribeBlock = window.vibeyard.usage.onBlockChange((info) => {
    currentBlock = info;
    render();
  });

  // Block-changed events fire only when the rounded BlockInfo changes. The
  // countdown text needs to keep ticking down between events, so render the
  // bottom row once a minute on its own.
  if (countdownTickerId !== null) clearInterval(countdownTickerId);
  countdownTickerId = window.setInterval(() => {
    if (currentBlock) renderBlockRow();
  }, COUNTDOWN_TICKER_MS);

  render();
}

function hide(): void {
  if (!containerEl) return;
  containerEl.classList.add('hidden');
}

function renderBlockRow(): void {
  if (!blockRowEl) return;
  if (!currentBlock) {
    blockRowEl.classList.add('hidden');
    blockRowEl.textContent = '';
    blockRowEl.removeAttribute('title');
    return;
  }
  const now = Date.now();
  const usd = formatUsd(currentBlock.usdSpent);
  const countdown = formatCountdown(currentBlock.resetsAt, now);
  blockRowEl.textContent = `${usd} · resets in ${countdown}`;
  blockRowEl.classList.remove('hidden');
  const resetTime = new Date(currentBlock.resetsAt).toLocaleTimeString();
  blockRowEl.title =
    `${usd} in current 5h block · resets at ${resetTime} · ` +
    `${currentBlock.entryCount} entries · local Claude usage only`;
}

function render(): void {
  if (!containerEl || !pctEl || !fillEl || !barEl) return;

  const visible = appState.preferences.sidebarViews?.usageIndicator ?? true;
  if (!visible) return hide();

  const session = appState.activeSession;
  if (!session) return hide();

  const cost = getCost(session.id);
  if (!cost || !cost.model) return hide();
  if (computeUsedTokens(cost) === 0) return hide();

  const limit = cost.contextWindowSize ?? getContextWindowLimit(cost.model);
  const used = computeUsedTokens(cost);
  const pct = Math.min(100, Math.round((used / limit) * 100));

  let level: 'normal' | 'warn' | 'danger' = 'normal';
  if (pct >= 90) level = 'danger';
  else if (pct >= 70) level = 'warn';

  const modelLabel = prettyModel(cost.model);
  const tooltip = `${used.toLocaleString()} / ${limit.toLocaleString()} tokens${modelLabel ? ` · ${modelLabel}` : ''}`;

  containerEl.classList.remove('hidden');
  containerEl.title = tooltip;
  pctEl.textContent = `${pct}%`;
  fillEl.style.width = `${pct}%`;
  fillEl.className = `sidebar-usage-fill sidebar-usage-${level}`;
  barEl.setAttribute('aria-valuenow', String(pct));

  renderBlockRow();
}

/** @internal Test-only: reset module state */
export function _resetForTesting(): void {
  if (unsubscribeCost) {
    unsubscribeCost();
    unsubscribeCost = null;
  }
  if (unsubscribeBlock) {
    unsubscribeBlock();
    unsubscribeBlock = null;
  }
  if (countdownTickerId !== null) {
    clearInterval(countdownTickerId);
    countdownTickerId = null;
  }
  if (clickHandler && clickHandlerEl) {
    clickHandlerEl.removeEventListener('click', clickHandler);
  }
  clickHandler = null;
  clickHandlerEl = null;
  while (appStateUnsubscribers.length > 0) {
    appStateUnsubscribers.pop()!();
  }
  containerEl = null;
  labelNameEl = null;
  pctEl = null;
  barEl = null;
  fillEl = null;
  blockRowEl = null;
  currentBlock = null;
}
