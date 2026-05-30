import { appState } from '../../state.js';
import { getBoard, addTag, removeTag, updateTagColor, getTagCount, TAG_COLORS } from '../../board-state.js';
import { createColumnElement } from './board-column.js';
import { showTaskModal } from './board-task-modal.js';
import { initBoardDnd, isDragActive, addDragEndCallback } from './board-dnd.js';
import { showConfirmModal } from '../modal.js';
import { showContextMenu } from './board-context-menu.js';
import { showBoardHelpDialog } from './board-help-dialog.js';
import { instances as kanbanInstances } from '../kanban/instance.js';
import type { BoardColumn, TagDefinition, BoardData } from '../../../shared/types.js';
import {
  setSearchQuery, getSearchQuery, toggleTagFilter, isTagFilterActive,
  hasActiveFilters, getFilteredTasks, onFilterChange, getActiveTagFilters,
} from '../../board-filter.js';
import { onChange as onStatusChange } from '../../session-activity.js';
import { onChange as onCostChange, getCost } from '../../session-cost.js';
import { onChange as onContextChange, getContext } from '../../session-context.js';
import { STATUS_LABELS, updateMetricsRow } from './board-card.js';

const svgIcon = (inner: string): string =>
  `<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

let boardEl: HTMLElement | null = null;
let pendingRender = false;
let offDragEnd: (() => void) | null = null;

function isKanbanActive(): boolean {
  const project = appState.activeProject;
  if (!project) return false;
  const active = project.sessions.find((s) => s.id === project.activeSessionId);
  return active?.type === 'kanban';
}

export function initBoard(): void {
  appState.on('board-changed', () => {
    if (isKanbanActive()) renderBoard();
  });
  appState.on('project-changed', () => {
    if (isKanbanActive()) renderBoard();
  });
  if (offDragEnd) offDragEnd();
  offDragEnd = addDragEndCallback(() => {
    if (pendingRender) renderBoard();
  });
  onFilterChange(() => {
    if (isKanbanActive()) renderBoard();
  });
  onStatusChange((sessionId, status) => {
    if (!boardEl) return;
    const dot = boardEl.querySelector(
      `.card-status-dot[data-session-id="${sessionId}"]`,
    ) as HTMLElement | null;
    if (!dot) return;
    dot.className = `card-status-dot ${status}`;
    const labelNode = dot.parentElement?.lastChild;
    if (labelNode && labelNode.nodeType === Node.TEXT_NODE) {
      labelNode.textContent = STATUS_LABELS[status];
    }
  });
  const refreshMetrics = (sessionId: string): void => {
    if (!boardEl) return;
    const row = boardEl.querySelector(
      `.board-card-metrics[data-session-id="${sessionId}"]`,
    ) as HTMLElement | null;
    if (row) updateMetricsRow(row, getCost(sessionId), getContext(sessionId));
  };
  onCostChange(refreshMetrics);
  onContextChange(refreshMetrics);

  let lastMetricsPref = appState.preferences.boardCardMetrics ?? true;
  appState.on('preferences-changed', () => {
    const cur = appState.preferences.boardCardMetrics ?? true;
    if (cur === lastMetricsPref) return;
    lastMetricsPref = cur;
    if (isKanbanActive()) renderBoard();
  });
}

export function createBoardView(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-view';

  const header = document.createElement('div');
  header.className = 'board-header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'board-title-group';

  const title = document.createElement('span');
  title.className = 'board-title';
  title.textContent = 'Board';

  const helpBtn = document.createElement('button');
  helpBtn.className = 'board-help-btn';
  helpBtn.title = 'About the board';
  helpBtn.setAttribute('aria-label', 'About the board');
  helpBtn.textContent = '?';
  helpBtn.addEventListener('click', () => showBoardHelpDialog());

  titleGroup.appendChild(title);
  titleGroup.appendChild(helpBtn);

  const actions = document.createElement('div');
  actions.className = 'board-header-actions';

  // Search box (rounded, with magnifier icon)
  const searchWrap = document.createElement('div');
  searchWrap.className = 'board-search';

  const searchIcon = document.createElement('span');
  searchIcon.className = 'board-search-icon';
  searchIcon.innerHTML = svgIcon('<circle cx="6" cy="6" r="4.25"/><line x1="9.25" y1="9.25" x2="12.5" y2="12.5"/>');

  const searchInput = document.createElement('input');
  searchInput.className = 'board-search-input';
  searchInput.placeholder = 'Search tasks';
  searchInput.value = getSearchQuery();

  let searchDebounce: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => setSearchQuery(searchInput.value), 150);
  });

  searchWrap.appendChild(searchIcon);
  searchWrap.appendChild(searchInput);

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-primary';
  addBtn.innerHTML = `${svgIcon('<line x1="7" y1="2.5" x2="7" y2="11.5"/><line x1="2.5" y1="7" x2="11.5" y2="7"/>')}<span>New task</span>`;
  addBtn.addEventListener('click', () => showTaskModal('create'));

  actions.appendChild(searchWrap);
  actions.appendChild(addBtn);

  header.appendChild(titleGroup);
  header.appendChild(actions);

  const tagRow = document.createElement('div');
  tagRow.className = 'board-tag-row';
  tagRow.id = 'board-tag-row';

  const columnsContainer = document.createElement('div');
  columnsContainer.className = 'board-columns';

  el.appendChild(header);
  el.appendChild(tagRow);
  el.appendChild(columnsContainer);

  return el;
}

export function renderBoard(target?: HTMLElement): void {
  if (isDragActive() || boardEl?.querySelector('.column-title-input')) {
    pendingRender = true;
    return;
  }
  pendingRender = false;

  const board = getBoard();
  if (!board) {
    console.warn('[kanban] renderBoard called with no active project board');
    return;
  }

  const container = target ?? activeKanbanContainer();
  if (!container) return;

  if (!boardEl) {
    boardEl = createBoardView();
  }

  if (!container.contains(boardEl)) {
    container.appendChild(boardEl);
  }
  boardEl.style.display = '';

  const columnsContainer = boardEl.querySelector('.board-columns')!;
  columnsContainer.innerHTML = '';

  const tagRow = boardEl.querySelector('#board-tag-row') as HTMLElement;
  if (tagRow) renderTagRow(tagRow, board);

  const sortedColumns = [...board.columns].sort((a, b) => a.order - b.order);
  const tasks = board.tasks;

  for (const column of sortedColumns) {
    const allColumnTasks = tasks
      .filter(t => t.columnId === column.id)
      .sort((a, b) => a.order - b.order);
    const filteredTasks = getFilteredTasks(allColumnTasks);
    const colEl = createColumnElement(column, filteredTasks, allColumnTasks.length);
    columnsContainer.appendChild(colEl);
  }

  initBoardDnd();
}

export function hideBoardView(): void {
  if (boardEl) {
    boardEl.style.display = 'none';
  }
}

function activeKanbanContainer(): HTMLElement | null {
  const project = appState.activeProject;
  if (!project) return null;
  const active = project.sessions.find((s) => s.id === project.activeSessionId);
  if (active?.type !== 'kanban') return null;
  const instance = kanbanInstances.get(active.id);
  return instance?.element ?? null;
}

export function destroyBoardView(): void {
  if (boardEl) {
    boardEl.remove();
    boardEl = null;
  }
  if (offDragEnd) {
    offDragEnd();
    offDragEnd = null;
  }
}

function renderTagRow(container: HTMLElement, board: BoardData): void {
  container.innerHTML = '';
  container.style.display = '';

  // Tags (only if tags exist)
  if (board.tags && board.tags.length > 0) {
    const label = document.createElement('span');
    label.className = 'board-tag-row-label';
    label.textContent = 'Filter';
    container.appendChild(label);

    const pillsContainer = document.createElement('div');
    pillsContainer.className = 'board-tag-row-pills';

    const MAX_VISIBLE = 10;
    const tags = board.tags;

    for (let i = 0; i < Math.min(tags.length, MAX_VISIBLE); i++) {
      const pill = createTagRowPill(tags[i]);
      pillsContainer.appendChild(pill);
    }

    if (tags.length > MAX_VISIBLE) {
      const moreBtn = document.createElement('button');
      moreBtn.className = 'board-tag-row-more';
      moreBtn.textContent = `+${tags.length - MAX_VISIBLE} more...`;
      moreBtn.addEventListener('click', () => {
        const isExpanded = pillsContainer.dataset.expanded === 'true';
        if (isExpanded) {
          while (pillsContainer.children.length > MAX_VISIBLE) {
            pillsContainer.removeChild(pillsContainer.lastChild!);
          }
          pillsContainer.appendChild(moreBtn);
          moreBtn.textContent = `+${tags.length - MAX_VISIBLE} more...`;
          pillsContainer.dataset.expanded = 'false';
        } else {
          moreBtn.remove();
          for (let i = MAX_VISIBLE; i < tags.length; i++) {
            pillsContainer.appendChild(createTagRowPill(tags[i]));
          }
          pillsContainer.appendChild(moreBtn);
          moreBtn.textContent = 'Show less';
          pillsContainer.dataset.expanded = 'true';
        }
      });
      pillsContainer.appendChild(moreBtn);
    }

    container.appendChild(pillsContainer);

    // "+" button to add new tag
    const addBtn = document.createElement('button');
    addBtn.className = 'board-tag-row-add';
    addBtn.textContent = '+';
    addBtn.title = 'Add tag';
    addBtn.addEventListener('click', () => showInlineTagInput(container));
    container.appendChild(addBtn);
  }

  // Filter count indicator
  if (hasActiveFilters()) {
    const total = board.tasks.length;
    const filtered = getFilteredTasks(board.tasks).length;
    const countEl = document.createElement('span');
    countEl.className = 'board-filter-count';
    countEl.textContent = `${filtered}/${total} tasks`;
    container.appendChild(countEl);
  }
}

function createTagRowPill(tag: TagDefinition): HTMLElement {
  const pill = document.createElement('span');
  pill.className = 'tag-pill tag-pill-header';
  pill.dataset.color = tag.color;
  pill.dataset.tagName = tag.name;
  pill.textContent = tag.name;

  if (hasActiveFilters() && getActiveTagFilters().size > 0 && !isTagFilterActive(tag.name)) {
    pill.classList.add('inactive');
  }

  pill.addEventListener('click', () => {
    toggleTagFilter(tag.name);
  });

  pill.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const colorItems = TAG_COLORS.map(color => ({
      label: `● ${color}`,
      action: () => updateTagColor(tag.name, color),
      disabled: color === tag.color,
    }));

    showContextMenu(e.clientX, e.clientY, [
      ...colorItems,
      { label: '', action: () => {}, disabled: true },
      {
        label: 'Delete Tag',
        danger: true,
        action: () => {
          const count = getTagCount(tag.name);
          const msg = count > 0
            ? `Delete tag "${tag.name}"? This will remove it from ${count} task(s).`
            : `Delete tag "${tag.name}"?`;
          showConfirmModal('Delete Tag', msg, () => removeTag(tag.name));
        },
      },
    ]);
  });

  return pill;
}

function showInlineTagInput(container: HTMLElement): void {
  const existing = container.querySelector('.board-tag-row-input');
  if (existing) { (existing as HTMLInputElement).focus(); return; }

  const input = document.createElement('input');
  input.className = 'board-tag-row-input';
  input.placeholder = 'Tag name...';
  input.maxLength = 30;

  const commit = () => {
    const name = input.value.trim();
    if (name) addTag(name);
    input.remove();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') input.remove();
  });
  input.addEventListener('blur', commit);

  const addBtn = container.querySelector('.board-tag-row-add');
  if (addBtn) container.insertBefore(input, addBtn);
  else container.appendChild(input);
  input.focus();
}
