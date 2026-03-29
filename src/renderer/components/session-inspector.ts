import { appState } from '../state.js';
import {
  getEvents,
  getToolStats,
  getContextHistory,
  getCostDeltas,
  onChange as onInspectorChange,
  clearSession,
} from '../session-inspector-state.js';
import { fitAllVisible, getTerminalInstance } from './terminal-pane.js';

let inspectorPanel: HTMLElement | null = null;
let inspectedSessionId: string | null = null;
let activeTab: 'timeline' | 'costs' | 'tools' | 'context' = 'timeline';
let updateTimer: ReturnType<typeof setTimeout> | null = null;
let resizing = false;
let reopenOnNextSession = false;

const expandedRows = new Set<string>();
let autoScroll = true;
let programmaticScroll = false;

export function isInspectorOpen(): boolean {
  return inspectorPanel !== null && inspectedSessionId !== null;
}

export function getInspectedSessionId(): string | null {
  return inspectedSessionId;
}

function resetUIState(): void {
  expandedRows.clear();
  autoScroll = true;
}

export function openInspector(sessionId: string): void {
  if (inspectorPanel && inspectedSessionId === sessionId) {
    closeInspector();
    return;
  }

  if (inspectedSessionId !== sessionId) resetUIState();
  inspectedSessionId = sessionId;

  if (!inspectorPanel) {
    inspectorPanel = createPanel();
    const container = document.getElementById('terminal-container')!;
    container.appendChild(inspectorPanel);
    container.classList.add('inspector-open');
    requestAnimationFrame(() => fitAllVisible());
  }

  renderActiveTab();
}

export function closeInspector(): void {
  if (!inspectorPanel) return;

  if (updateTimer) {
    clearTimeout(updateTimer);
    updateTimer = null;
  }

  const container = document.getElementById('terminal-container')!;
  container.classList.remove('inspector-open');
  inspectorPanel.remove();
  inspectorPanel = null;
  inspectedSessionId = null;

  requestAnimationFrame(() => fitAllVisible());
}

export function toggleInspector(): void {
  const project = appState.activeProject;
  if (!project?.activeSessionId) return;
  const session = project.sessions.find(s => s.id === project.activeSessionId);
  if (!session || (session.type && session.type !== 'claude')) return;

  if (isInspectorOpen()) {
    closeInspector();
  } else {
    openInspector(project.activeSessionId);
  }
}

export function initSessionInspector(): void {
  // Auto-follow active session
  appState.on('session-changed', () => {
    if (!isInspectorOpen()) return;
    const project = appState.activeProject;
    if (project?.activeSessionId && project.activeSessionId !== inspectedSessionId) {
      const session = project.sessions.find(s => s.id === project.activeSessionId);
      if (session && (!session.type || session.type === 'claude')) {
        resetUIState();
        inspectedSessionId = project.activeSessionId;
        renderActiveTab();
      }
    }
  });

  // Clear inspector events when /clear resets the CLI session
  appState.on('cli-session-cleared', (data) => {
    const d = data as { sessionId?: string } | undefined;
    if (!d?.sessionId) return;
    clearSession(d.sessionId);
    if (isInspectorOpen() && d.sessionId === inspectedSessionId) {
      renderActiveTab();
    }
  });

  // Clean up inspector state and close panel when session is removed
  appState.on('session-removed', (data) => {
    const d = data as { sessionId?: string } | undefined;
    if (!d?.sessionId) return;
    clearSession(d.sessionId);
    if (isInspectorOpen() && d.sessionId === inspectedSessionId) {
      reopenOnNextSession = true;
      closeInspector();
    }
  });

  // Re-open inspector when a new session is added after a clear/removal
  appState.on('session-added', (data) => {
    if (!reopenOnNextSession) return;
    reopenOnNextSession = false;
    const d = data as { session?: { id: string; type?: string } } | undefined;
    if (d?.session && (!d.session.type || d.session.type === 'claude')) {
      requestAnimationFrame(() => openInspector(d.session!.id));
    }
  });

  // Update inspector on new events (debounced)
  onInspectorChange((sessionId) => {
    if (sessionId !== inspectedSessionId) return;
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => renderActiveTab(), 200);
  });

  // Keyboard shortcut: Cmd+Shift+I
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'I') {
      e.preventDefault();
      toggleInspector();
    }
  });
}

function createPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'session-inspector';

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'inspector-resize-handle';
  resizeHandle.addEventListener('mousedown', startResize);
  panel.appendChild(resizeHandle);

  // Header
  const header = document.createElement('div');
  header.className = 'inspector-header';

  const title = document.createElement('div');
  title.className = 'inspector-title';
  title.textContent = 'Session Inspector';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'inspector-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', closeInspector);
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Tabs
  const tabBar = document.createElement('div');
  tabBar.className = 'inspector-tabs';
  const tabs: { id: typeof activeTab; label: string }[] = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'costs', label: 'Costs' },
    { id: 'tools', label: 'Tools' },
    { id: 'context', label: 'Context' },
  ];
  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.className = 'inspector-tab' + (tab.id === activeTab ? ' active' : '');
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.addEventListener('click', () => {
      activeTab = tab.id;
      tabBar.querySelectorAll('.inspector-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderActiveTab();
    });
    tabBar.appendChild(btn);
  }
  panel.appendChild(tabBar);

  const scrollToggle = document.createElement('button');
  scrollToggle.className = 'inspector-autoscroll-toggle active';
  scrollToggle.textContent = 'Auto-scroll';
  scrollToggle.title = 'Toggle auto-scroll to bottom';
  scrollToggle.addEventListener('click', () => {
    autoScroll = !autoScroll;
    scrollToggle.classList.toggle('active', autoScroll);
    if (autoScroll) {
      const content = panel.querySelector('.inspector-content') as HTMLElement;
      if (content) content.scrollTop = content.scrollHeight;
    }
  });
  panel.appendChild(scrollToggle);

  // Content area
  const content = document.createElement('div');
  content.className = 'inspector-content';

  content.addEventListener('scroll', () => {
    if (activeTab !== 'timeline' || programmaticScroll) return;
    const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 30;
    // Only disable auto-scroll when user scrolls away from bottom;
    // re-enabling should only happen via the toggle button
    if (autoScroll && !atBottom) {
      autoScroll = false;
      scrollToggle.classList.toggle('active', false);
    }
  });

  panel.appendChild(content);

  return panel;
}

function renderActiveTab(): void {
  if (!inspectorPanel || !inspectedSessionId) return;
  const content = inspectorPanel.querySelector('.inspector-content') as HTMLElement;
  if (!content) return;

  const toggle = inspectorPanel.querySelector('.inspector-autoscroll-toggle') as HTMLElement;
  if (toggle) toggle.style.display = activeTab === 'timeline' ? '' : 'none';

  content.innerHTML = '';

  switch (activeTab) {
    case 'timeline': renderTimeline(content); break;
    case 'costs': renderCosts(content); break;
    case 'tools': renderTools(content); break;
    case 'context': renderContext(content); break;
  }
}

// --- Timeline View ---

function renderTimeline(container: HTMLElement): void {
  const events = getEvents(inspectedSessionId!);
  if (events.length === 0) {
    container.innerHTML = `<div class="inspector-empty">${emptyMessage('No events yet')}</div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'inspector-timeline';

  const sessionStart = events[0].timestamp;
  const costDeltas = getCostDeltas(inspectedSessionId!);
  const deltaMap = new Map(costDeltas.map(d => [d.index, d.delta]));

  // Show last 500 events
  const startIdx = Math.max(0, events.length - 500);
  if (startIdx > 0) {
    const loadMore = document.createElement('div');
    loadMore.className = 'inspector-load-more';
    loadMore.textContent = `${startIdx} earlier events not shown`;
    list.appendChild(loadMore);
  }

  for (let i = startIdx; i < events.length; i++) {
    const ev = events[i];
    const row = document.createElement('div');
    row.className = 'inspector-timeline-row';

    // Timestamp
    const timeEl = document.createElement('span');
    timeEl.className = 'inspector-time';
    timeEl.textContent = formatRelativeTime(ev.timestamp - sessionStart);

    // Type badge
    const badge = document.createElement('span');
    badge.className = `inspector-badge inspector-badge-${badgeClass(ev.type)}`;
    badge.textContent = badgeLabel(ev.type);

    // Description
    const desc = document.createElement('span');
    desc.className = 'inspector-desc';
    if (ev.tool_name) {
      desc.textContent = ev.tool_name;
    } else if (ev.type === 'user_prompt') {
      desc.textContent = 'User prompt submitted';
    } else if (ev.type === 'stop') {
      desc.textContent = 'Response completed';
    } else if (ev.type === 'stop_failure') {
      desc.textContent = ev.error || 'Response stopped with error';
    } else if (ev.type === 'session_start') {
      desc.textContent = 'Session started';
    } else if (ev.type === 'session_end') {
      desc.textContent = 'Session ended';
    } else if (ev.type === 'permission_request') {
      desc.textContent = 'Waiting for permission';
    } else if (ev.type === 'subagent_start') {
      desc.textContent = ev.agent_id ? `Subagent started: ${ev.agent_id}` : 'Subagent started';
    } else if (ev.type === 'subagent_stop') {
      desc.textContent = ev.agent_id ? `Subagent stopped: ${ev.agent_id}` : 'Subagent stopped';
    } else if (ev.type === 'notification') {
      desc.textContent = ev.message || 'Notification';
    } else if (ev.type === 'pre_compact') {
      desc.textContent = 'Context compaction starting';
    } else if (ev.type === 'post_compact') {
      desc.textContent = 'Context compaction complete';
    } else if (ev.type === 'task_created') {
      desc.textContent = ev.task_id ? `Task created: ${ev.task_id}` : 'Task created';
    } else if (ev.type === 'task_completed') {
      desc.textContent = ev.task_id ? `Task completed: ${ev.task_id}` : 'Task completed';
    } else if (ev.type === 'worktree_create') {
      desc.textContent = ev.worktree_path || 'Worktree created';
    } else if (ev.type === 'worktree_remove') {
      desc.textContent = ev.worktree_path || 'Worktree removed';
    } else if (ev.type === 'cwd_changed') {
      desc.textContent = ev.cwd || 'Working directory changed';
    } else if (ev.type === 'file_changed') {
      desc.textContent = ev.file_path || 'File changed';
    } else if (ev.type === 'config_change') {
      desc.textContent = ev.config_key ? `Config: ${ev.config_key}` : 'Config changed';
    } else if (ev.type === 'elicitation') {
      desc.textContent = ev.question || 'Elicitation requested';
    } else if (ev.type === 'elicitation_result') {
      desc.textContent = 'Elicitation answered';
    } else if (ev.type === 'instructions_loaded') {
      desc.textContent = 'Instructions loaded';
    } else if (ev.type === 'teammate_idle') {
      desc.textContent = ev.agent_id ? `Teammate idle: ${ev.agent_id}` : 'Teammate idle';
    }

    // Duration to next event
    const durationEl = document.createElement('span');
    durationEl.className = 'inspector-duration';
    if (i < events.length - 1) {
      const durationMs = events[i + 1].timestamp - ev.timestamp;
      durationEl.textContent = formatDuration(durationMs);
    }

    // Cost delta
    const costEl = document.createElement('span');
    costEl.className = 'inspector-cost-delta';
    const delta = deltaMap.get(i);
    if (delta !== undefined && delta > 0) {
      costEl.textContent = `+$${delta.toFixed(4)}`;
    }

    row.appendChild(timeEl);
    row.appendChild(badge);
    row.appendChild(desc);
    row.appendChild(durationEl);
    row.appendChild(costEl);

    // Expandable tool input
    if (ev.tool_input) {
      row.classList.add('inspector-expandable');
      const key = `${ev.timestamp}:${ev.type}:${ev.tool_name || ''}`;

      if (expandedRows.has(key)) {
        row.appendChild(createToolInputEl(ev.tool_input));
      }

      row.addEventListener('click', () => {
        const existing = row.querySelector('.inspector-tool-input');
        if (existing) {
          existing.remove();
          expandedRows.delete(key);
          return;
        }
        expandedRows.add(key);
        row.appendChild(createToolInputEl(ev.tool_input));
      });
    }

    if (ev.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'inspector-error-text';
      errorEl.textContent = ev.error.length > 200 ? ev.error.slice(0, 200) + '...' : ev.error;
      row.appendChild(errorEl);
    }

    list.appendChild(row);
  }

  container.appendChild(list);

  if (autoScroll) {
    requestAnimationFrame(() => {
      programmaticScroll = true;
      container.scrollTop = container.scrollHeight;
      programmaticScroll = false;
    });
  }
}

// --- Costs View ---

function renderCosts(container: HTMLElement): void {
  const events = getEvents(inspectedSessionId!);
  const costDeltas = getCostDeltas(inspectedSessionId!);

  if (events.length === 0) {
    container.innerHTML = `<div class="inspector-empty">${emptyMessage('No events yet')}</div>`;
    return;
  }

  // Summary bar — scan backwards without copying the array
  let totalCost = 0;
  let totalTokens = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    if (totalCost === 0 && events[i].cost_snapshot) {
      totalCost = events[i].cost_snapshot!.total_cost_usd;
    }
    if (totalTokens === 0 && events[i].context_snapshot) {
      totalTokens = events[i].context_snapshot!.total_tokens;
    }
    if (totalCost !== 0 && totalTokens !== 0) break;
  }
  const stepsWithCost = costDeltas.filter(d => d.delta > 0).length;

  const summary = document.createElement('div');
  summary.className = 'inspector-summary';
  summary.innerHTML = `
    <div class="inspector-summary-item"><span class="inspector-summary-label">Total Cost</span><span class="inspector-summary-value">$${totalCost.toFixed(4)}</span></div>
    <div class="inspector-summary-item"><span class="inspector-summary-label">Total Tokens</span><span class="inspector-summary-value">${formatTokenCount(totalTokens)}</span></div>
    <div class="inspector-summary-item"><span class="inspector-summary-label">Avg Cost/Step</span><span class="inspector-summary-value">$${stepsWithCost > 0 ? (totalCost / stepsWithCost).toFixed(4) : '0.0000'}</span></div>
  `;
  container.appendChild(summary);

  // Cost table
  const table = document.createElement('table');
  table.className = 'inspector-table';
  table.innerHTML = '<thead><tr><th>#</th><th>Event</th><th>Tool</th><th>Cost Delta</th><th>Cumulative</th></tr></thead>';
  const tbody = document.createElement('tbody');

  const deltaMap = new Map(costDeltas.map(d => [d.index, d.delta]));

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev.cost_snapshot && !deltaMap.has(i)) continue;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${badgeLabel(ev.type)}</td>
      <td>${ev.tool_name ? escapeHtml(ev.tool_name) : '-'}</td>
      <td>${deltaMap.has(i) ? `+$${deltaMap.get(i)!.toFixed(4)}` : '-'}</td>
      <td>${ev.cost_snapshot ? `$${ev.cost_snapshot.total_cost_usd.toFixed(4)}` : '-'}</td>
    `;
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

// --- Tools View ---

function renderTools(container: HTMLElement): void {
  const stats = getToolStats(inspectedSessionId!);

  if (stats.length === 0) {
    container.innerHTML = `<div class="inspector-empty">${emptyMessage('No tool calls yet')}</div>`;
    return;
  }

  const table = document.createElement('table');
  table.className = 'inspector-table';
  table.innerHTML = '<thead><tr><th>Tool</th><th>Calls</th><th>Failures</th><th>Rate</th><th>Cost</th></tr></thead>';
  const tbody = document.createElement('tbody');

  for (const s of stats) {
    const tr = document.createElement('tr');
    const rate = s.calls > 0 ? ((s.failures / s.calls) * 100).toFixed(0) : '0';
    tr.innerHTML = `
      <td>${escapeHtml(s.tool_name)}</td>
      <td>${s.calls}</td>
      <td>${s.failures}</td>
      <td>${rate}%</td>
      <td>$${s.totalCost.toFixed(4)}</td>
    `;
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  container.appendChild(table);

  // Bar chart for top 10 tools
  const maxCalls = stats[0]?.calls ?? 1;
  const chart = document.createElement('div');
  chart.className = 'inspector-bar-chart';

  for (const s of stats.slice(0, 10)) {
    const bar = document.createElement('div');
    bar.className = 'inspector-bar-row';
    const pct = (s.calls / maxCalls) * 100;
    bar.innerHTML = `
      <span class="inspector-bar-label">${escapeHtml(s.tool_name)}</span>
      <div class="inspector-bar-track">
        <div class="inspector-bar-fill" style="width: ${pct}%"></div>
      </div>
      <span class="inspector-bar-count">${s.calls}</span>
    `;
    chart.appendChild(bar);
  }

  container.appendChild(chart);
}

// --- Context View ---

function renderContext(container: HTMLElement): void {
  const history = getContextHistory(inspectedSessionId!);

  if (history.length === 0) {
    container.innerHTML = `<div class="inspector-empty">${emptyMessage('No context data yet')}</div>`;
    return;
  }

  const latest = history[history.length - 1];

  // Current gauge
  const gauge = document.createElement('div');
  gauge.className = 'inspector-context-gauge';
  const pct = latest.usedPercentage;
  const color = pct >= 90 ? 'var(--accent)' : pct >= 70 ? '#f4b400' : '#34a853';
  gauge.innerHTML = `
    <div class="inspector-gauge-label">Context Window Usage</div>
    <div class="inspector-gauge-bar">
      <div class="inspector-gauge-fill" style="width: ${pct}%; background: ${color}"></div>
    </div>
    <div class="inspector-gauge-text">${pct.toFixed(1)}% &middot; ${formatTokenCount(latest.totalTokens)} tokens</div>
  `;
  container.appendChild(gauge);

  // History SVG chart
  if (history.length >= 2) {
    const svgWidth = 320;
    const svgHeight = 160;
    const padding = { top: 10, right: 10, bottom: 25, left: 35 };
    const chartW = svgWidth - padding.left - padding.right;
    const chartH = svgHeight - padding.top - padding.bottom;

    const minTime = history[0].timestamp;
    const maxTime = history[history.length - 1].timestamp;
    const timeRange = maxTime - minTime || 1;

    const points = history.map(p => {
      const x = padding.left + ((p.timestamp - minTime) / timeRange) * chartW;
      const y = padding.top + chartH - (p.usedPercentage / 100) * chartH;
      return { x, y };
    });

    const polylinePoints = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaPoints = `${padding.left},${padding.top + chartH} ` + polylinePoints + ` ${points[points.length - 1].x},${padding.top + chartH}`;

    // Time labels
    const durationMin = (maxTime - minTime) / 60000;
    const midLabel = (durationMin / 2).toFixed(0) + 'm';
    const endLabel = durationMin.toFixed(0) + 'm';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${svgHeight}`);
    svg.setAttribute('class', 'inspector-context-chart');
    svg.innerHTML = `
      <!-- Warning bands -->
      <rect x="${padding.left}" y="${padding.top}" width="${chartW}" height="${chartH * 0.05}" fill="rgba(233,69,96,0.1)" />
      <rect x="${padding.left}" y="${padding.top + chartH * 0.05}" width="${chartW}" height="${chartH * 0.15}" fill="rgba(244,180,0,0.08)" />
      <!-- Threshold lines -->
      <line x1="${padding.left}" y1="${padding.top + chartH * 0.05}" x2="${padding.left + chartW}" y2="${padding.top + chartH * 0.05}" stroke="var(--accent)" stroke-width="0.5" stroke-dasharray="3,3" opacity="0.5" />
      <line x1="${padding.left}" y1="${padding.top + chartH * 0.2}" x2="${padding.left + chartW}" y2="${padding.top + chartH * 0.2}" stroke="#f4b400" stroke-width="0.5" stroke-dasharray="3,3" opacity="0.5" />
      <!-- Area fill -->
      <polygon points="${areaPoints}" fill="rgba(66,133,244,0.15)" />
      <!-- Line -->
      <polyline points="${polylinePoints}" fill="none" stroke="#4285f4" stroke-width="1.5" />
      <!-- Y-axis labels -->
      <text x="${padding.left - 4}" y="${padding.top + 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">100%</text>
      <text x="${padding.left - 4}" y="${padding.top + chartH * 0.2 + 3}" fill="var(--text-muted)" font-size="9" text-anchor="end">80%</text>
      <text x="${padding.left - 4}" y="${padding.top + chartH * 0.5 + 3}" fill="var(--text-muted)" font-size="9" text-anchor="end">50%</text>
      <text x="${padding.left - 4}" y="${padding.top + chartH}" fill="var(--text-muted)" font-size="9" text-anchor="end">0%</text>
      <!-- X-axis labels -->
      <text x="${padding.left}" y="${svgHeight - 4}" fill="var(--text-muted)" font-size="9" text-anchor="start">0m</text>
      <text x="${padding.left + chartW / 2}" y="${svgHeight - 4}" fill="var(--text-muted)" font-size="9" text-anchor="middle">${midLabel}</text>
      <text x="${padding.left + chartW}" y="${svgHeight - 4}" fill="var(--text-muted)" font-size="9" text-anchor="end">${endLabel}</text>
    `;
    container.appendChild(svg);
  }
}

// --- Helpers ---

function emptyMessage(fallback: string): string {
  if (!inspectedSessionId) return fallback;
  const instance = getTerminalInstance(inspectedSessionId);
  return instance?.isResume ? 'Session resumed — history not available' : fallback;
}

function createToolInputEl(toolInput: unknown): HTMLPreElement {
  const el = document.createElement('pre');
  el.className = 'inspector-tool-input';
  const text = JSON.stringify(toolInput, null, 2);
  el.textContent = text.length > 2000 ? text.slice(0, 2000) + '\n...' : text;
  return el;
}

function formatRelativeTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function badgeClass(type: string): string {
  switch (type) {
    case 'user_prompt': return 'prompt';
    case 'tool_use': case 'pre_tool_use': return 'tool';
    case 'tool_failure': case 'stop_failure': return 'failure';
    case 'stop': return 'stop';
    case 'session_start': return 'start';
    case 'permission_request': case 'elicitation': case 'elicitation_result': return 'input';
    case 'subagent_start': case 'subagent_stop': case 'teammate_idle': return 'agent';
    case 'session_end': case 'pre_compact': case 'post_compact': case 'instructions_loaded': return 'lifecycle';
    case 'task_created': case 'task_completed': return 'task';
    case 'cwd_changed': case 'file_changed': case 'config_change': case 'worktree_create': case 'worktree_remove': return 'system';
    case 'notification': return 'notify';
    default: return 'default';
  }
}

function badgeLabel(type: string): string {
  switch (type) {
    case 'user_prompt': return 'Prompt';
    case 'tool_use': return 'Tool';
    case 'pre_tool_use': return 'Pre-Tool';
    case 'tool_failure': return 'Failure';
    case 'stop': return 'Done';
    case 'stop_failure': return 'Error';
    case 'session_start': return 'Start';
    case 'session_end': return 'End';
    case 'permission_request': return 'Input';
    case 'subagent_start': return 'Agent+';
    case 'subagent_stop': return 'Agent-';
    case 'notification': return 'Notify';
    case 'pre_compact': return 'Compact';
    case 'post_compact': return 'Compact';
    case 'task_created': return 'Task+';
    case 'task_completed': return 'Task OK';
    case 'worktree_create': return 'Worktree+';
    case 'worktree_remove': return 'Worktree-';
    case 'cwd_changed': return 'CWD';
    case 'file_changed': return 'File';
    case 'config_change': return 'Config';
    case 'elicitation': return 'Ask';
    case 'elicitation_result': return 'Answer';
    case 'instructions_loaded': return 'Instr';
    case 'teammate_idle': return 'Idle';
    default: return escapeHtml(type);
  }
}

function startResize(e: MouseEvent): void {
  e.preventDefault();
  resizing = true;
  const startX = e.clientX;
  const container = document.getElementById('terminal-container')!;
  const startWidth = inspectorPanel?.offsetWidth ?? 350;

  const onMouseMove = (e: MouseEvent) => {
    if (!resizing) return;
    const diff = startX - e.clientX;
    const newWidth = Math.min(Math.max(startWidth + diff, 250), 800);
    container.style.setProperty('--inspector-width', `${newWidth}px`);
  };

  const onMouseUp = () => {
    resizing = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    requestAnimationFrame(() => fitAllVisible());
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}
