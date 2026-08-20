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

export interface AgentSpan {
  agentId: string;
  startIdx: number;
  stopIdx: number;          // events.length if still running
  isRunning: boolean;
  parentAgentId: string | null;
  childEventIndices: number[]; // sorted event indices belonging to this agent
}

export interface AgentModel {
  spans: Map<string, AgentSpan>;       // agentId → span
  eventOwner: Map<number, string>;     // event index → owning agentId
  stopIndices: Set<number>;            // all stop event indices (to skip in rendering)
  startToAgent: Map<number, string>;   // startIdx → agentId (for render dispatch)
}

/**
 * Build an agent model that pairs agent lifecycles by `agent_id` and assigns
 * child events based on each event's own `agent_id`.
 */
export function buildAgentModel(events: InspectorEvent[], startIdx: number): AgentModel {
  const spans = new Map<string, AgentSpan>();
  const startToAgent = new Map<number, string>();
  const openAgents = new Map<string, AgentSpan>();

  for (let i = startIdx; i < events.length; i++) {
    const ev = events[i];

    if (ev.type === 'subagent_start' && ev.agent_id) {
      const span: AgentSpan = {
        agentId: ev.agent_id,
        startIdx: i,
        stopIdx: events.length,
        isRunning: true,
        parentAgentId: null,
        childEventIndices: [],
      };
      spans.set(ev.agent_id, span);
      startToAgent.set(i, ev.agent_id);
      openAgents.set(ev.agent_id, span);
    } else if (ev.type === 'subagent_stop' && ev.agent_id) {
      const span = openAgents.get(ev.agent_id);
      if (span) {
        span.stopIdx = i;
        span.isRunning = false;
        openAgents.delete(ev.agent_id);
      }
    } else if (ev.agent_id) {
      const owner = spans.get(ev.agent_id);
      if (owner) {
        owner.childEventIndices.push(i);
      }
    }
  }

  for (const span of spans.values()) {
    span.childEventIndices.sort((a, b) => a - b);
  }

  const stopIndices = new Set<number>();
  const eventOwner = new Map<number, string>();
  for (const span of spans.values()) {
    if (!span.isRunning) stopIndices.add(span.stopIdx);
    for (const idx of span.childEventIndices) {
      eventOwner.set(idx, span.agentId);
    }
  }

  return { spans, eventOwner, stopIndices, startToAgent };
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
  const sessionId = inspectorState.inspectedSessionId!;
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

  const model = buildAgentModel(events, startIdx);
  const { spans: agentSpans, stopIndices, startToAgent } = model;
  const renderedIndices = new Set<number>();

  /** Render events from `from` to `to` (exclusive), appending to `parent`. */
  function renderEvents(from: number, to: number, parent: HTMLElement): void {
    for (let i = from; i < to; i++) {
      if (renderedIndices.has(i)) continue;
      const ev = events[i];
      if (ev.type === 'status_update') continue;
      if (stopIndices.has(i)) continue; // skip subagent_stop — merged into header

      const agentId = startToAgent.get(i);
      if (ev.type === 'subagent_start' && agentId) {
        const span = agentSpans.get(agentId);
        if (span) {
          renderAgentGroup(agentId, parent);
          continue;
        }
      }

      parent.appendChild(renderEventRow(i, ev));
    }
  }

  /** Render a collapsible agent group: header row + nested children. */
  function renderAgentGroup(agentId: string, parent: HTMLElement): void {
    const span = agentSpans.get(agentId)!;
    const startEv = events[span.startIdx];
    const { isRunning } = span;
    const stopEv = isRunning ? null : events[span.stopIdx];
    const now = Date.now();
    const duration = isRunning
      ? now - startEv.timestamp
      : stopEv!.timestamp - startEv.timestamp;
    const childCount = countChildEvents(span);

    // Mark all span indices as rendered
    renderedIndices.add(span.startIdx);
    if (!isRunning) renderedIndices.add(span.stopIdx);
    for (const idx of span.childEventIndices) renderedIndices.add(idx);

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
    const groupKey = `agent-group:${agentId}`;
    const autoExpandKey = `${sessionId}:${groupKey}`;
    if (isRunning
      && !inspectorState.expandedRows.has(groupKey)
      && !inspectorState.autoExpandedAgentGroups.has(autoExpandKey)) {
      inspectorState.expandedRows.add(groupKey);
      inspectorState.autoExpandedAgentGroups.add(autoExpandKey);
    }
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

    // Children: subagent_start as first, owned child events, subagent_stop as last
    const renderChildren = () => {
      const children = document.createElement('div');
      children.className = 'inspector-agent-children';
      children.appendChild(renderEventRow(span.startIdx, startEv));
      for (const idx of span.childEventIndices) {
        children.appendChild(renderEventRow(idx, events[idx]));
      }
      if (stopEv) children.appendChild(renderEventRow(span.stopIdx, stopEv));
      return children;
    };

    if (inspectorState.expandedRows.has(groupKey)) {
      group.appendChild(renderChildren());
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
        group.appendChild(renderChildren());
      }
    });

    parent.appendChild(group);
  }

  function countChildEvents(span: AgentSpan): number {
    let count = 0;
    for (const idx of span.childEventIndices) {
      if (events[idx].type !== 'status_update') count++;
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
      desc.textContent = ev.prompt
        ? ev.prompt.replace(/\s+/g, ' ').slice(0, 120)
        : 'User prompt submitted';
    } else if (ev.type === 'stop') {
      desc.textContent = 'Response completed';
    } else if (ev.type === 'stop_failure') {
      desc.textContent = ev.error || ev.error_details || 'Response stopped with error';
    } else if (ev.type === 'session_start') {
      desc.textContent = 'Session started';
    } else if (ev.type === 'session_end') {
      desc.textContent = ev.reason ? `Session ended: ${ev.reason}` : 'Session ended';
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
      desc.textContent = ev.title
        ? `${ev.title}: ${ev.message ?? ''}`.trim()
        : ev.message || ev.notification_type || 'Notification';
    } else if (ev.type === 'pre_compact') {
      desc.textContent = 'Context compaction starting';
    } else if (ev.type === 'post_compact') {
      desc.textContent = 'Context compaction complete';
    } else if (ev.type === 'task_created') {
      const label = ev.task_subject || ev.task_id;
      desc.textContent = label ? `Task created: ${label}` : 'Task created';
    } else if (ev.type === 'task_completed') {
      const label = ev.task_subject || ev.task_id;
      desc.textContent = label ? `Task completed: ${label}` : 'Task completed';
    } else if (ev.type === 'worktree_create') {
      desc.textContent = ev.worktree_path || 'Worktree created';
    } else if (ev.type === 'worktree_remove') {
      desc.textContent = ev.worktree_path || 'Worktree removed';
    } else if (ev.type === 'cwd_changed') {
      // `new_cwd`, not the common `cwd` field — that one is the directory the
      // hook ran in, i.e. the value *before* the change.
      desc.textContent = ev.new_cwd || 'Working directory changed';
    } else if (ev.type === 'file_changed') {
      const p = ev.file_path;
      desc.textContent = p ? (ev.event ? `${ev.event}: ${p}` : p) : 'File changed';
    } else if (ev.type === 'config_change') {
      desc.textContent = ev.file_path ? `Config: ${ev.file_path}` : 'Config changed';
    } else if (ev.type === 'elicitation') {
      desc.textContent = ev.message || ev.mcp_server_name || 'Elicitation requested';
    } else if (ev.type === 'elicitation_result') {
      desc.textContent = ev.action ? `Elicitation ${ev.action}` : 'Elicitation answered';
    } else if (ev.type === 'instructions_loaded') {
      desc.textContent = ev.file_path || 'Instructions loaded';
    } else if (ev.type === 'teammate_idle') {
      // TeammateIdle carries no agent_id/agent_type, so agentLabel never resolves.
      desc.textContent = `Teammate idle: ${ev.teammate_name || agentLabel(ev)}`;
    }

    // Duration. Prefer the tool's own reported execution time when the hook
    // supplied one — the delta to the next event also counts permission prompts
    // and PreToolUse hook time, which the tool didn't spend.
    const durationEl = document.createElement('span');
    durationEl.className = 'inspector-duration';
    if (typeof ev.duration_ms === 'number') {
      durationEl.textContent = formatDuration(ev.duration_ms);
    } else if (i < events.length - 1) {
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
