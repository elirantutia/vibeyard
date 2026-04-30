import { appState } from '../state.js';
import { onChange as onCostChange, getCost } from '../session-cost.js';
import type { CostInfo } from '../session-cost.js';

// All current Anthropic models (Sonnet/Opus/Haiku 4.x) ship with a 200K window.
// Update this table if a future model variant ships with a different default.
const CONTEXT_LIMIT_DEFAULT = 200_000;
const CONTEXT_LIMIT_OPUS_1M = 1_000_000;

let containerEl: HTMLElement | null = null;
let labelNameEl: HTMLElement | null = null;
let pctEl: HTMLElement | null = null;
let barEl: HTMLElement | null = null;
let fillEl: HTMLElement | null = null;
let unsubscribeCost: (() => void) | null = null;
const appStateUnsubscribers: Array<() => void> = [];

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
  // "Opus 4.7 (1M context)" or "Sonnet 4.6". If it already contains a space and
  // an uppercase letter, treat it as already formatted.
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
}

export function initSidebarUsage(): void {
  containerEl = document.getElementById('sidebar-usage');
  if (!containerEl) return;
  buildDom(containerEl);

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

  render();
}

function hide(): void {
  if (!containerEl) return;
  containerEl.classList.add('hidden');
}

function render(): void {
  if (!containerEl || !pctEl || !fillEl || !barEl) return;

  const visible = appState.preferences.sidebarViews?.usageIndicator ?? true;
  if (!visible) return hide();

  const session = appState.activeSession;
  if (!session) return hide();

  // Guard: regex fallback in session-cost.ts only carries USD — no model name.
  // Hide if we don't have structured data (no model = no token counts to trust).
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
}

/** @internal Test-only: reset module state */
export function _resetForTesting(): void {
  if (unsubscribeCost) {
    unsubscribeCost();
    unsubscribeCost = null;
  }
  while (appStateUnsubscribers.length > 0) {
    appStateUnsubscribers.pop()!();
  }
  containerEl = null;
  labelNameEl = null;
  pctEl = null;
  barEl = null;
  fillEl = null;
}
