import { appState, type SessionRecord } from '../state.js';
import { getProviderCapabilities, getProviderDisplayName } from '../provider-availability.js';
import type { ProviderId, CliProviderCapabilities, InspectorEvent } from '../../shared/types.js';
import { getTerminalInstance } from './terminal-pane.js';
import { inspectorState } from './session-inspector-state-ui.js';
import { isCliSession } from '../session-utils.js';

export function resetUIState(): void {
  inspectorState.expandedRows.clear();
  inspectorState.autoExpandedAgentGroups.clear();
  inspectorState.autoScroll = true;
}

export function canInspectSession(session: Pick<SessionRecord, 'type' | 'providerId'>): boolean {
  if (!isCliSession(session)) return false;
  return getProviderCapabilities(session.providerId || 'claude')?.hookStatus !== false;
}

export function getInspectedProviderId(): ProviderId {
  const session = appState.activeProject?.sessions.find(s => s.id === inspectorState.inspectedSessionId);
  return session?.providerId || 'claude';
}

/** Show an "unsupported" message and return true if the capability is explicitly false. */
export function renderUnsupportedGuard(
  container: HTMLElement,
  capability: keyof CliProviderCapabilities,
  label: string,
): boolean {
  const providerId = getInspectedProviderId();
  const caps = getProviderCapabilities(providerId);
  if (caps?.[capability] === false) {
    const name = getProviderDisplayName(providerId);
    container.innerHTML = `<div class="inspector-empty">${label} is not supported for ${name} sessions</div>`;
    return true;
  }
  return false;
}

export function emptyMessage(fallback: string): string {
  if (!inspectorState.inspectedSessionId) return fallback;
  const instance = getTerminalInstance(inspectorState.inspectedSessionId);
  if (!instance?.wasResumed) return fallback;
  const label = fallback.toLowerCase().includes('tool') ? 'tools' : fallback.toLowerCase().includes('context') ? 'context' : 'history';
  return `Session resumed — ${label} not available`;
}

export function createToolInputEl(toolInput: unknown): HTMLPreElement {
  const el = document.createElement('pre');
  el.className = 'inspector-tool-input';
  el.addEventListener('click', (e) => e.stopPropagation());
  const text = JSON.stringify(toolInput, null, 2);
  el.textContent = text.length > 2000 ? text.slice(0, 2000) + '\n...' : text;
  return el;
}

export interface McpToolInfo {
  rawToolName: string;
  server: string;
  tool: string;
  displayLabel: string;
}

export function parseMcpToolName(toolName?: string): McpToolInfo | null {
  if (!toolName?.startsWith('mcp__')) return null;
  const parts = toolName.split('__');
  if (parts.length < 3) return null;

  const server = parts[1]?.trim();
  const tool = parts.slice(2).join('__').trim();
  if (!server || !tool) return null;

  return {
    rawToolName: toolName,
    server,
    tool,
    displayLabel: `${server} / ${tool}`,
  };
}

export function isMcpToolEvent(ev: Pick<InspectorEvent, 'type' | 'tool_name'>): boolean {
  if (!parseMcpToolName(ev.tool_name)) return false;
  return ev.type === 'pre_tool_use'
    || ev.type === 'tool_use'
    || ev.type === 'tool_failure'
    || ev.type === 'permission_request'
    || ev.type === 'permission_denied';
}

export function createToolDetailEl(toolInput: unknown, rawToolName?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'inspector-tool-detail';
  el.addEventListener('click', (e) => e.stopPropagation());

  if (rawToolName) {
    const row = document.createElement('div');
    row.className = 'inspector-tool-detail-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'inspector-tool-detail-label';
    labelEl.textContent = 'Raw Tool';

    const valueEl = document.createElement('span');
    valueEl.className = 'inspector-tool-detail-value';
    valueEl.textContent = rawToolName;

    row.appendChild(labelEl);
    row.appendChild(valueEl);
    el.appendChild(row);
  }

  el.appendChild(createToolInputEl(toolInput));
  return el;
}

export function makeExpandable(row: HTMLElement, key: string, selector: string, create: () => HTMLElement): void {
  row.classList.add('inspector-expandable');
  if (inspectorState.expandedRows.has(key)) {
    row.appendChild(create());
  }
  row.addEventListener('click', () => {
    const existing = row.querySelector(selector);
    if (existing) {
      existing.remove();
      inspectorState.expandedRows.delete(key);
      return;
    }
    inspectorState.expandedRows.add(key);
    row.appendChild(create());
  });
}

export function agentLabel(ev: InspectorEvent): string {
  return ev.agent_type || ev.agent_id || 'Subagent';
}

export function isAgentEvent(ev: InspectorEvent): boolean {
  return ev.type === 'subagent_start' || ev.type === 'subagent_stop' || ev.type === 'teammate_idle';
}

export function findAgentDuration(events: InspectorEvent[], stopIndex: number): number | null {
  const stopEv = events[stopIndex];
  if (stopEv.type !== 'subagent_stop' || !stopEv.agent_id) return null;
  for (let j = stopIndex - 1; j >= 0; j--) {
    if (events[j].type === 'subagent_start' && events[j].agent_id === stopEv.agent_id) {
      return stopEv.timestamp - events[j].timestamp;
    }
  }
  return null;
}

export function createAgentDetailEl(ev: InspectorEvent, duration: number | null): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'inspector-agent-detail';
  el.addEventListener('click', (e) => e.stopPropagation());

  const entries: [string, string][] = [];
  if (ev.agent_type) entries.push(['Type', ev.agent_type]);
  if (ev.agent_id) entries.push(['ID', ev.agent_id]);

  if (ev.type === 'subagent_stop') {
    if (duration !== null) entries.push(['Duration', formatDuration(duration)]);
    if (ev.agent_transcript_path) entries.push(['Transcript', ev.agent_transcript_path]);
    if (ev.last_assistant_message) {
      const msg = ev.last_assistant_message.length > 500
        ? ev.last_assistant_message.slice(0, 500) + '...'
        : ev.last_assistant_message;
      entries.push(['Result', msg]);
    }
  }

  if (entries.length === 0) {
    el.textContent = 'No additional details';
    return el;
  }

  for (const [label, value] of entries) {
    const row = document.createElement('div');
    row.className = 'inspector-agent-detail-row';
    const labelEl = document.createElement('span');
    labelEl.className = 'inspector-agent-detail-label';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'inspector-agent-detail-value';
    valueEl.textContent = value;
    row.appendChild(labelEl);
    row.appendChild(valueEl);
    el.appendChild(row);
  }

  return el;
}

export function formatRelativeTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function badgeClass(type: string): string {
  switch (type) {
    case 'user_prompt': return 'prompt';
    case 'tool_use': case 'pre_tool_use': return 'tool';
    case 'tool_failure': case 'stop_failure': return 'failure';
    case 'stop': return 'stop';
    case 'session_start': return 'start';
    case 'permission_request': case 'permission_denied': case 'elicitation': case 'elicitation_result': return 'input';
    case 'subagent_start': case 'subagent_stop': case 'teammate_idle': return 'agent';
    case 'session_end': case 'pre_compact': case 'post_compact': case 'instructions_loaded': return 'lifecycle';
    case 'task_created': case 'task_completed': return 'task';
    case 'cwd_changed': case 'file_changed': case 'config_change': case 'worktree_create': case 'worktree_remove': case 'status_update': return 'system';
    case 'notification': return 'notify';
    default: return 'default';
  }
}

export function badgeLabel(type: string): string {
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
    case 'permission_denied': return 'Denied';
    case 'subagent_start': return 'Agent';
    case 'subagent_stop': return 'Agent';
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
    case 'status_update': return 'Status';
    default: return escapeHtml(type);
  }
}
