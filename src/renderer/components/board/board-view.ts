import { appState } from '../../state.js';
import { getBoard, addTag, removeTag, updateTagColor, getTagCount } from '../../board-state.js';
import { createColumnElement } from './board-column.js';
import { showTaskModal } from './board-task-modal.js';
import { initBoardDnd, cleanupBoardDnd, isDragActive, setDragEndCallback } from './board-dnd.js';
import { showConfirmModal } from '../modal.js';
import { showContextMenu } from './board-context-menu.js';
import type { BoardColumn, TagDefinition, BoardData } from '../../../shared/types.js';
import {
  setSearchQuery, getSearchQuery, toggleTagFilter, isTagFilterActive,
  hasActiveFilters, getFilteredTasks, onFilterChange, getActiveTagFilters,
} from '../../board-filter.js';

let boardEl: HTMLElement | null = null;
let dndInitialized = false;
let pendingRender = false;

export function initBoard(): void {
  appState.on('board-changed', () => {
    if (appState.activeProject?.layout.mode === 'board') renderBoard();
  });
  appState.on('project-changed', () => {
    if (appState.activeProject?.layout.mode === 'board') renderBoard();
  });
  appState.on('layout-changed', () => {
    if (appState.activeProject?.layout.mode === 'board') {
      renderBoard();
    } else {
      hideBoardView();
    }
  });
  setDragEndCallback(() => {
    if (pendingRender) renderBoard();
  });
  onFilterChange(() => {
    if (appState.activeProject?.layout.mode === 'board') renderBoard();
  });
}

export function createBoardView(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-view';

  const header = document.createElement('div');
  header.className = 'board-header';

  const title = document.createElement('span');
  title.className = 'board-title';
  title.textContent = 'Board';

  const addBtn = document.createElement('button');
  addBtn.className = 'board-add-task';
  addBtn.textContent = '+ Add Task';
  addBtn.addEventListener('click', () => showTaskModal('create'));

  header.appendChild(title);
  header.appendChild(addBtn);

  const tagRow = document.createElement('div');
  tagRow.className = 'board-tag-row';
  tagRow.id = 'board-tag-row';

  const columnsContainer = document.createElement('div');
  columnsContainer.className = 'board-columns';

  el.appendChild(header);
  el.insertBefore(tagRow, columnsContainer);
  el.appendChild(columnsContainer);

  return el;
}

export function renderBoard(): void {
  if (isDragActive()) {
    pendingRender = true;
    return;
  }
  pendingRender = false;

  const board = getBoard();
  if (!board) return;

  const container = document.getElementById('terminal-container')!;

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

  if (!dndInitialized) {
    initBoardDnd();
    dndInitialized = true;
  }
}

export function hideBoardView(): void {
  if (boardEl) {
    boardEl.style.display = 'none';
  }
}

export function destroyBoardView(): void {
  if (boardEl) {
    boardEl.remove();
    boardEl = null;
  }
  if (dndInitialized) {
    cleanupBoardDnd();
    dndInitialized = false;
  }
}

const TAG_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'cyan', 'pink', 'gray'];

function renderTagRow(container: HTMLElement, board: BoardData): void {
  container.innerHTML = '';
  container.style.display = '';

  // Search input
  const searchInput = document.createElement('input');
  searchInput.className = 'board-search-input';
  searchInput.placeholder = '\u{1F50D} Search tasks...';
  searchInput.value = getSearchQuery();

  let debounceTimer: ReturnType<typeof setTimeout>;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => setSearchQuery(searchInput.value), 150);
  });

  container.appendChild(searchInput);

  // Separator + tags (only if tags exist)
  if (board.tags && board.tags.length > 0) {
    const sep = document.createElement('div');
    sep.className = 'board-filter-separator';
    container.appendChild(sep);

    const label = document.createElement('span');
    label.className = 'board-tag-row-label';
    label.textContent = 'Tags';
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
