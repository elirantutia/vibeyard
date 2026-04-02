import { getEvents, getCostDeltas } from '../session-inspector-state.js';
import type { InspectorEvent } from '../../shared/types.js';
import { inspectorState } from './session-inspector-state-ui.js';
import {
  emptyMessage,
  formatRelativeTime,
  formatDuration,
  badgeClass,
  badgeLabel,
  agentLabel,
  isAgentEvent,
  findAgentDuration,
  makeExpandable,
  createToolDetailEl,
  createAgentDetailEl,
  parseMcpToolName,
  isMcpToolEvent,
  escapeHtml,
} from './session-inspector-utils.js';

/**
 * Map subagent_start index → end index.
 * End is the matching subagent_stop index, or events.length for agents still running.
 */
function buildAgentSpans(events: InspectorEvent[], startIdx: number): Map<number, number> {
  const spans = new Map<number, number>();
  const openStarts = new Map<string, number>();
  for (let i = startIdx; i < events.length; i++) {
    const ev = events[i];
    if (ev.type === 'subagent_start' && ev.agent_id) {
      openStarts.set(ev.agent_id, i);
    } else if (ev.type === 'subagent_stop' && ev.agent_id) {
      const startI = openStarts.get(ev.agent_id);
      if (startI !== undefined) {
        spans.set(startI, i);
        openStarts.delete(ev.agent_id);
      }
    }
  }
  // Open agents (still running) span to end of events
  for (const startI of openStarts.values()) {
    spans.set(startI, events.length);
  }
  return spans;
}

export function renderTimeline(container: HTMLElement): void {
  const events = getEvents(inspectorState.inspectedSessionId!);
  if (events.length === 0) {
    container.innerHTML = `<div class="inspector-empty">${emptyMessage('No events yet')}</div>`;
    return;
  }

  const list = document.createElement('div');
  list.className = 'inspector-timeline';

  const sessionStart = events[0].timestamp;
  const costDeltas = getCostDeltas(inspectorState.inspectedSessionId!);
  const deltaMap = new Map(costDeltas.map(d => [d.index, d.delta]));

  // Show last 500 events
  const startIdx = Math.max(0, events.length - 500);
  if (startIdx > 0) {
    const loadMore = document.createElement('div');
    loadMore.className = 'inspector-load-more';
    loadMore.textContent = `${startIdx} earlier events not shown`;
    list.appendChild(loadMore);
  }

  const agentSpans = buildAgentSpans(events, startIdx);
  // Stop indices are skipped — their info merges into the agent group header
  const stopIndices = new Set(agentSpans.values());

  /** Render events from `from` to `to` (exclusive), appending to `parent`. */
  function renderEvents(from: number, to: number, parent: HTMLElement): void {
    for (let i = from; i < to; i++) {
      const ev = events[i];
      if (ev.type === 'status_update') continue;
      if (stopIndices.has(i)) continue; // skip subagent_stop — merged into header

      // If this is a subagent_start with a matched stop, render as a group
      const stopIdx = agentSpans.get(i);
      if (ev.type === 'subagent_start' && stopIdx !== undefined) {
        renderAgentGroup(i, stopIdx, parent);
        i = stopIdx; // skip past the agent span (loop will i++)
        continue;
      }

      parent.appendChild(renderEventRow(i, ev));
    }
  }

  /** Render a collapsible agent group: header row + nested children. */
  function renderAgentGroup(startI: number, stopI: number, parent: HTMLElement): void {
    const startEv = events[startI];
    const isRunning = stopI >= events.length;
    const stopEv = isRunning ? null : events[stopI];
    const now = Date.now();
    const duration = isRunning
      ? now - startEv.timestamp
      : stopEv!.timestamp - startEv.timestamp;
    const childEnd = isRunning ? events.length : stopI;
    const childCount = countChildEvents(startI + 1, childEnd);

    const group = document.createElement('div');
    group.className = 'inspector-agent-group';
    if (isRunning) group.classList.add('inspector-agent-running');

    // Header row
    const row = document.createElement('div');
    row.className = 'inspector-timeline-row inspector-agent-header';

    const timeEl = document.createElement('span');
    timeEl.className = 'inspector-time';
    timeEl.textContent = formatRelativeTime(startEv.timestamp - sessionStart);

    const badge = document.createElement('span');
    badge.className = 'inspector-badge inspector-badge-agent';
    badge.textContent = isRunning ? 'Agent\u2026' : 'Agent';

    const toggleEl = document.createElement('span');
    toggleEl.className = 'inspector-agent-toggle';
    const groupKey = `agent-group:${startEv.agent_id || startI}`;
    if (isRunning) inspectorState.expandedRows.add(groupKey);
    toggleEl.textContent = inspectorState.expandedRows.has(groupKey) ? '\u25BC' : '\u25B6';

    const desc = document.createElement('span');
    desc.className = 'inspector-desc';
    const parts = [agentLabel(startEv)];
    parts.push(formatDuration(duration));
    if (childCount > 0) parts.push(`${childCount} action${childCount !== 1 ? 's' : ''}`);
    desc.textContent = parts.join(' \u00B7 ');

    row.appendChild(timeEl);
    row.appendChild(badge);
    row.appendChild(toggleEl);
    row.appendChild(desc);

    group.appendChild(row);

    // Children: subagent_start as first, inner events, subagent_stop as last
    if (inspectorState.expandedRows.has(groupKey)) {
      const children = document.createElement('div');
      children.className = 'inspector-agent-children';
      children.appendChild(renderEventRow(startI, startEv));
      renderEvents(startI + 1, childEnd, children);
      if (stopEv) children.appendChild(renderEventRow(stopI, stopEv));
      group.appendChild(children);
    }

    row.addEventListener('click', () => {
      if (inspectorState.expandedRows.has(groupKey)) {
        inspectorState.expandedRows.delete(groupKey);
      } else {
        inspectorState.expandedRows.add(groupKey);
      }
      toggleEl.textContent = inspectorState.expandedRows.has(groupKey) ? '\u25BC' : '\u25B6';
      const existing = group.querySelector('.inspector-agent-children');
      if (existing) {
        existing.remove();
      } else {
        const children = document.createElement('div');
        children.className = 'inspector-agent-children';
        children.appendChild(renderEventRow(startI, startEv));
        renderEvents(startI + 1, childEnd, children);
        if (stopEv) children.appendChild(renderEventRow(stopI, stopEv));
        group.appendChild(children);
      }
    });

    parent.appendChild(group);
  }

  function countChildEvents(from: number, to: number): number {
    let count = 0;
    for (let i = from; i < to; i++) {
      if (events[i].type !== 'status_update' && !stopIndices.has(i)) count++;
    }
    return count;
  }

  /** Render a single event row (non-agent-group). */
  function renderEventRow(i: number, ev: InspectorEvent): HTMLDivElement {
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

    const mcpTool = parseMcpToolName(ev.tool_name);
    const showMcpBadge = mcpTool && isMcpToolEvent(ev);
    const mcpBadge = showMcpBadge ? document.createElement('span') : null;
    if (mcpBadge) {
      mcpBadge.className = 'inspector-badge inspector-badge-mcp';
      mcpBadge.textContent = 'MCP';
    }

    // Description
    const desc = document.createElement('span');
    desc.className = 'inspector-desc';
    if (ev.tool_name) {
      desc.textContent = mcpTool?.displayLabel ?? ev.tool_name;
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
      // Unmatched start (agent still running) — render inline
      desc.textContent = `Agent started: ${agentLabel(ev)}`;
    } else if (ev.type === 'subagent_stop') {
      const duration = findAgentDuration(events, i);
      desc.textContent = duration
        ? `Agent stopped: ${agentLabel(ev)} (${formatDuration(duration)})`
        : `Agent stopped: ${agentLabel(ev)}`;
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
      desc.textContent = `Teammate idle: ${agentLabel(ev)}`;
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
    if (mcpBadge) row.appendChild(mcpBadge);
    row.appendChild(desc);
    row.appendChild(durationEl);
    row.appendChild(costEl);

    // Expandable tool input
    if (ev.tool_input) {
      makeExpandable(row, `${ev.timestamp}:${ev.type}:${ev.tool_name || ''}`, '.inspector-tool-detail',
        () => createToolDetailEl(ev.tool_input!, mcpTool?.rawToolName));
    }

    // Expandable agent detail (for unmatched agent events only)
    if (isAgentEvent(ev)) {
      const duration = ev.type === 'subagent_stop' ? findAgentDuration(events, i) : null;
      makeExpandable(row, `${ev.timestamp}:${ev.type}:${ev.agent_id || ''}`, '.inspector-agent-detail',
        () => createAgentDetailEl(ev, duration));
    }

    if (ev.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'inspector-error-text';
      errorEl.textContent = ev.error.length > 200 ? ev.error.slice(0, 200) + '...' : ev.error;
      row.appendChild(errorEl);
    }

    return row;
  }

  renderEvents(startIdx, events.length, list);

  container.appendChild(list);

  if (inspectorState.autoScroll) {
    requestAnimationFrame(() => {
      inspectorState.programmaticScroll = true;
      container.scrollTop = container.scrollHeight;
      inspectorState.programmaticScroll = false;
    });
  }
}
