import { closeModal } from './modal.js';
import type { StatsCache } from '../types.js';

const overlay = document.getElementById('modal-overlay')!;
const modal = document.getElementById('modal')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel')!;
const btnConfirm = document.getElementById('modal-confirm')!;

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function prettyModelName(raw: string): string {
  const stripped = raw.replace(/^claude-/, '').replace(/-\d{8,}$/, '');
  const parts = stripped.split('-');
  const family = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  const version = parts.slice(1).join('.');
  return version ? `${family} ${version}` : family;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short' });
}

function renderStats(container: HTMLElement, stats: StatsCache): void {
  // Summary cards
  const summary = document.createElement('div');
  summary.className = 'usage-summary';

  const cards: { value: string; label: string }[] = [
    { value: formatNumber(stats.totalSessions), label: 'Total Sessions' },
    { value: formatNumber(stats.totalMessages), label: 'Total Messages' },
    { value: formatDate(stats.firstSessionDate), label: 'Using Since' },
    { value: stats.lastComputedDate, label: 'Last Updated' },
  ];

  for (const card of cards) {
    const el = document.createElement('div');
    el.className = 'usage-stat-card';
    el.innerHTML = `<div class="usage-stat-value">${card.value}</div><div class="usage-stat-label">${card.label}</div>`;
    summary.appendChild(el);
  }
  container.appendChild(summary);

  // Last 7 days activity
  const recent = stats.dailyActivity.slice(-7);
  if (recent.length > 0) {
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'usage-section-title';
    sectionTitle.textContent = 'Last 7 Days';
    container.appendChild(sectionTitle);

    const maxMsg = Math.max(...recent.map(d => d.messageCount), 1);

    const chart = document.createElement('div');
    chart.className = 'usage-activity-chart';
    for (const day of recent) {
      const bar = document.createElement('div');
      bar.className = 'usage-activity-bar';
      const pct = (day.messageCount / maxMsg) * 100;
      bar.style.height = `${Math.max(pct, 3)}%`;
      bar.title = `${day.date}: ${formatNumber(day.messageCount)} messages, ${formatNumber(day.sessionCount)} sessions`;
      chart.appendChild(bar);
    }
    container.appendChild(chart);

    const labels = document.createElement('div');
    labels.className = 'usage-activity-labels';
    for (const day of recent) {
      const span = document.createElement('span');
      span.textContent = shortDay(day.date);
      labels.appendChild(span);
    }
    container.appendChild(labels);
  }

  // Model usage breakdown
  const modelEntries = Object.entries(stats.modelUsage);
  if (modelEntries.length > 0) {
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'usage-section-title';
    sectionTitle.textContent = 'Model Usage';
    container.appendChild(sectionTitle);

    for (const [model, usage] of modelEntries) {
      const row = document.createElement('div');
      row.className = 'usage-model-row';

      const totalTokens = usage.inputTokens + usage.outputTokens;
      const cacheTokens = usage.cacheReadInputTokens + usage.cacheCreationInputTokens;

      row.innerHTML = `
        <span class="usage-model-name">${prettyModelName(model)}</span>
        <span class="usage-model-tokens">${formatTokens(totalTokens)} tokens · ${formatTokens(cacheTokens)} cache</span>
      `;
      container.appendChild(row);
    }
  }

  // Hourly activity heatmap
  const hourEntries = Object.entries(stats.hourCounts);
  if (hourEntries.length > 0) {
    const sectionTitle = document.createElement('div');
    sectionTitle.className = 'usage-section-title';
    sectionTitle.textContent = 'Activity by Hour';
    container.appendChild(sectionTitle);

    const maxCount = Math.max(...Object.values(stats.hourCounts), 1);

    const heatmap = document.createElement('div');
    heatmap.className = 'usage-hour-heatmap';
    for (let h = 0; h < 24; h++) {
      const cell = document.createElement('div');
      cell.className = 'usage-hour-cell';
      const count = stats.hourCounts[String(h)] || 0;
      const intensity = count / maxCount;
      cell.style.opacity = String(Math.max(0.08, intensity));
      cell.title = `${h}:00 — ${formatNumber(count)} sessions`;
      heatmap.appendChild(cell);
    }
    container.appendChild(heatmap);

    const hourLabels = document.createElement('div');
    hourLabels.className = 'usage-hour-labels';
    hourLabels.innerHTML = '<span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>';
    container.appendChild(hourLabels);
  }

  // Refresh button
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'usage-refresh-btn';
  refreshBtn.textContent = 'Refresh';
  refreshBtn.addEventListener('click', async () => {
    refreshBtn.textContent = 'Loading...';
    refreshBtn.disabled = true;
    try {
      const fresh = await window.claudeIde.stats.getCache();
      container.innerHTML = '';
      if (fresh) {
        renderStats(container, fresh);
      } else {
        renderEmpty(container);
      }
    } catch {
      refreshBtn.textContent = 'Refresh';
      refreshBtn.disabled = false;
    }
  });
  container.appendChild(refreshBtn);
}

function renderEmpty(container: HTMLElement): void {
  const empty = document.createElement('div');
  empty.className = 'usage-empty';
  empty.textContent = 'No usage data found. Stats are generated by Claude Code CLI.';
  container.appendChild(empty);
}

export async function showUsageModal(): Promise<void> {
  titleEl.textContent = 'Usage Stats';
  bodyEl.innerHTML = '';
  modal.classList.add('modal-wide');

  const content = document.createElement('div');
  content.className = 'usage-content';
  content.innerHTML = '<div class="usage-empty">Loading...</div>';
  bodyEl.appendChild(content);

  btnConfirm.textContent = 'Done';
  btnCancel.style.display = 'none';
  overlay.classList.remove('hidden');

  // Clean up previous listeners
  if ((overlay as any)._cleanup) {
    (overlay as any)._cleanup();
    (overlay as any)._cleanup = null;
  }

  const handleClose = () => {
    closeModal();
    modal.classList.remove('modal-wide');
    btnConfirm.textContent = 'Create';
    btnCancel.style.display = '';
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      handleClose();
    }
  };

  btnConfirm.addEventListener('click', handleClose);
  btnCancel.addEventListener('click', handleClose);
  document.addEventListener('keydown', handleKeydown);

  (overlay as any)._cleanup = () => {
    btnConfirm.removeEventListener('click', handleClose);
    btnCancel.removeEventListener('click', handleClose);
    document.removeEventListener('keydown', handleKeydown);
  };

  // Load stats
  try {
    const stats = await window.claudeIde.stats.getCache();
    content.innerHTML = '';
    if (stats) {
      renderStats(content, stats);
    } else {
      renderEmpty(content);
    }
  } catch {
    content.innerHTML = '';
    renderEmpty(content);
  }
}
