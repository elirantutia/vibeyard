import type { BoardTask, CostInfo, ContextWindowInfo, ArchivedSession, ProviderId } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { getColumnByBehavior, updateTask, moveTask, deleteTask, getTagColor } from '../../board-state.js';
import { getStatus, type SessionStatus } from '../../session-activity.js';
import { getCost, formatTokens } from '../../session-cost.js';
import { getContext, getContextSeverity } from '../../session-context.js';
import { hasMultipleAvailableProviders } from '../../provider-availability.js';
import { showTaskModal } from './board-task-modal.js';
import { showContextMenu } from './board-context-menu.js';
import { showConfirmModal } from '../modal.js';
import { setPendingPrompt } from '../terminal-pane.js';
import { t } from '../../i18n.js';

export function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'working': return t('board.status.working');
    case 'waiting': return t('board.status.waiting');
    case 'idle': return t('board.status.idle');
    case 'completed': return t('board.status.done');
    case 'input': return t('board.status.input');
  }
}

export function createCardElement(task: BoardTask): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-card';
  el.dataset.taskId = task.id;
  el.draggable = true;

  // Top row: title + action button
  const topRow = document.createElement('div');
  topRow.className = 'board-card-top';

  if (hasMultipleAvailableProviders()) {
    const providerId = resolveTaskProviderId(task);
    const icon = document.createElement('img');
    icon.className = 'tab-provider-icon';
    icon.src = `assets/providers/${providerId}.png`;
    icon.alt = providerId;
    icon.onerror = () => { icon.style.display = 'none'; };
    topRow.appendChild(icon);
  }

  const titleEl = document.createElement('div');
  titleEl.className = 'board-card-title';
  titleEl.textContent = task.title || truncate(task.prompt, 60) || t('board.card.untitledFallback');

  const runBtn = document.createElement('button');
  runBtn.className = 'card-run-btn';
  const hasActiveSession = !!task.sessionId;
  const canResume = !hasActiveSession && !!task.cliSessionId;
  runBtn.title = hasActiveSession ? t('board.card.focusSessionTooltip') : canResume ? t('board.card.resumeTooltip') : t('board.card.runTooltip');
  runBtn.textContent = hasActiveSession ? '>>>' : canResume ? '\u21BB' : '\u25B6';
  runBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    runTask(task);
  });

  topRow.appendChild(titleEl);
  topRow.appendChild(runBtn);
  el.appendChild(topRow);

  // Tags row (if any)
  if (task.tags && task.tags.length > 0) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'board-card-tags';
    const maxVisible = 3;
    const visibleTags = task.tags.slice(0, maxVisible);
    for (const tagName of visibleTags) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill tag-pill-sm';
      pill.dataset.color = getTagColor(tagName);
      pill.textContent = tagName;
      tagsEl.appendChild(pill);
    }
    if (task.tags.length > maxVisible) {
      const more = document.createElement('span');
      more.className = 'tag-pill-overflow';
      more.textContent = `+${task.tags.length - maxVisible}`;
      tagsEl.appendChild(more);
    }
    el.appendChild(tagsEl);
  }

  if (task.sessionId) {
    const status = getStatus(task.sessionId);
    if (status) {
      const bottomRow = document.createElement('div');
      bottomRow.className = 'board-card-bottom';

      const statusEl = document.createElement('span');
      statusEl.className = 'board-card-status-inline';
      const dot = document.createElement('span');
      dot.className = `card-status-dot ${status}`;
      dot.dataset.sessionId = task.sessionId;
      statusEl.appendChild(dot);
      statusEl.appendChild(document.createTextNode(statusLabel(status)));
      bottomRow.appendChild(statusEl);
      el.appendChild(bottomRow);
    }
  }

  const metricsRow = buildMetricsRow(task);
  if (metricsRow) el.appendChild(metricsRow);

  // Click card body -> edit modal
  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    showTaskModal('edit', task);
  });

  // Right-click -> context menu
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showContextMenu(e.clientX, e.clientY, [
      { label: t('contextMenu.card.edit'), action: () => showTaskModal('edit', task) },
      { label: t('contextMenu.card.delete'), danger: true, action: () => confirmDeleteTask(task) },
    ]);
  });

  return el;
}

function confirmDeleteTask(task: BoardTask): void {
  const label = task.title || task.prompt.slice(0, 40) || t('board.card.fallbackLabel');
  showConfirmModal(
    t('board.deleteTaskTitle'),
    t('board.deleteTaskMessage', { label }),
    () => deleteTask(task.id),
  );
}


export async function runTask(task: BoardTask): Promise<void> {
  const project = appState.activeProject;
  if (!project) return;

  // If task has active session, just focus it
  if (task.sessionId) {
    focusTaskSession(task);
    return;
  }

  let resumed = false;

  // Try to resume from cliSessionId
  if (task.cliSessionId) {
    const existingSession = project.sessions.find(s => s.cliSessionId === task.cliSessionId);
    if (existingSession) {
      appState.setActiveSession(project.id, existingSession.id);
      updateTask(task.id, { sessionId: existingSession.id });
      resumed = true;
    } else {
      const archived = project.sessionHistory?.find(a => a.cliSessionId === task.cliSessionId);
      if (archived) {
        const session = await appState.resumeFromHistorySafe(project.id, archived.id);
        if (session) {
          updateTask(task.id, { sessionId: session.id });
          resumed = true;
        }
      }
    }
  }

  // Fallback: spawn a fresh session
  if (!resumed) {
    if (!task.prompt.trim()) {
      showTaskModal('edit', task);
      return;
    }
    const sessionName = task.title || task.prompt.slice(0, 40);
    const session = task.planMode
      ? appState.addPlanSession(project.id, sessionName, true, task.providerId, task.profileId)
      : appState.addSession(project.id, sessionName, undefined, task.providerId, task.profileId);
    if (session) {
      updateTask(task.id, { sessionId: session.id });
      const activeCol = getColumnByBehavior('active');
      if (activeCol && task.columnId !== activeCol.id) {
        moveTask(task.id, activeCol.id, 0);
      }
      // Set prompt on the terminal instance — it will be passed as a
      // CLI startup argument when spawnTerminal runs (via requestAnimationFrame)
      if (task.prompt.trim()) {
        setPendingPrompt(session.id, task.prompt);
      }
    }
  }
}

export function focusTaskSession(task: BoardTask): void {
  const project = appState.activeProject;
  if (!project || !task.sessionId) return;
  appState.setActiveSession(project.id, task.sessionId);
}

function truncate(str: string, len: number): string {
  if (!str) return '';
  const firstLine = str.split('\n')[0];
  return firstLine.length > len ? firstLine.slice(0, len) + '...' : firstLine;
}

function resolveTaskProviderId(task: BoardTask): ProviderId {
  const project = appState.activeProject;
  if (task.sessionId && project) {
    const session = project.sessions.find(s => s.id === task.sessionId);
    if (session?.providerId) return session.providerId;
  }
  return task.providerId ?? appState.preferences.defaultProvider ?? 'claude';
}

function getArchivedCost(task: BoardTask): ArchivedSession['cost'] | null {
  if (!task.cliSessionId) return null;
  return appState.activeProject?.sessionHistory?.find(
    (a) => a.cliSessionId === task.cliSessionId,
  )?.cost ?? null;
}

function buildMetricsRow(task: BoardTask): HTMLElement | null {
  if (appState.preferences.boardCardMetrics === false) return null;
  if (!task.sessionId && !task.cliSessionId) return null;

  const cost = task.sessionId ? getCost(task.sessionId) : null;
  const ctx = task.sessionId ? getContext(task.sessionId) : null;
  const archivedCost = cost ? null : getArchivedCost(task);

  const row = document.createElement('div');
  row.className = 'board-card-metrics';
  if (task.sessionId) row.dataset.sessionId = task.sessionId;
  if (task.cliSessionId) row.dataset.cliSessionId = task.cliSessionId;

  updateMetricsRow(row, cost, ctx, archivedCost);
  return row;
}

export function updateMetricsRow(
  row: HTMLElement,
  cost: CostInfo | null,
  ctx: ContextWindowInfo | null,
  archivedCost: ArchivedSession['cost'] | null = null,
): void {
  row.innerHTML = '';

  const usd = cost?.totalCostUsd ?? archivedCost?.totalCostUsd ?? null;
  const inputTokens = cost?.totalInputTokens ?? archivedCost?.totalInputTokens ?? 0;
  const outputTokens = cost?.totalOutputTokens ?? archivedCost?.totalOutputTokens ?? 0;
  const totalTokens = inputTokens + outputTokens;

  if (usd !== null) {
    const costEl = document.createElement('span');
    costEl.className = 'card-cost';
    costEl.textContent = `$${usd.toFixed(4)}`;
    if (cost) {
      const dur = (cost.totalDurationMs / 1000).toFixed(1);
      const apiDur = (cost.totalApiDurationMs / 1000).toFixed(1);
      const modelPrefix = cost.model ? `${cost.model} · ` : '';
      costEl.title = `${modelPrefix}${t('board.card.costTooltip', { read: formatTokens(cost.cacheReadTokens), create: formatTokens(cost.cacheCreationTokens), dur, apiDur })}`;
    } else if (archivedCost) {
      const dur = (archivedCost.totalDurationMs / 1000).toFixed(1);
      costEl.title = t('board.card.costTooltipArchived', { dur });
    }
    row.appendChild(costEl);
  }

  if (totalTokens > 0) {
    const tokensEl = document.createElement('span');
    tokensEl.className = 'card-tokens';
    tokensEl.textContent = formatTokens(totalTokens);
    tokensEl.title = t('board.card.tokenTooltip', { input: formatTokens(inputTokens), output: formatTokens(outputTokens) });
    row.appendChild(tokensEl);
  }

  if (ctx) {
    const pct = Math.min(Math.round(ctx.usedPercentage), 100);
    const ctxEl = document.createElement('span');
    const severity = getContextSeverity(pct);
    ctxEl.className = severity ? `card-ctx ${severity}` : 'card-ctx';
    ctxEl.textContent = `${pct}%`;
    ctxEl.title = t('board.card.contextTooltip', { total: ctx.totalTokens.toLocaleString(), window: ctx.contextWindowSize.toLocaleString() });
    row.appendChild(ctxEl);
  }
}
