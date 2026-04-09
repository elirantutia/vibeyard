import type { BoardColumn, BoardTask } from '../../../shared/types.js';
import { renameColumn, deleteColumn, addColumn, getBoard, reorderColumns } from '../../board-state.js';
import { createCardElement } from './board-card.js';
import { showTaskModal } from './board-task-modal.js';
import { showContextMenu } from './board-context-menu.js';
import { showConfirmModal } from '../modal.js';

export function createColumnElement(column: BoardColumn, tasks: BoardTask[], totalCount?: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'board-column';
  el.dataset.columnId = column.id;
  el.dataset.behavior = column.behavior;

  // Header
  const header = document.createElement('div');
  header.className = 'board-column-header';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'column-title';
  titleSpan.textContent = column.title;
  titleSpan.addEventListener('dblclick', () => startInlineRename(titleSpan, column));

  const countSpan = document.createElement('span');
  countSpan.className = 'column-count';
  countSpan.textContent = totalCount !== undefined && totalCount !== tasks.length
    ? `${tasks.length}/${totalCount}`
    : String(tasks.length);

  header.appendChild(titleSpan);
  header.appendChild(countSpan);

  // Right-click on header → column context menu
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    showColumnContextMenu(e.clientX, e.clientY, column);
  });

  // Cards area (drop zone)
  const cardsArea = document.createElement('div');
  cardsArea.className = 'board-column-cards';
  cardsArea.dataset.columnId = column.id;

  if (tasks.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'board-column-empty-hint';
    const hintMap: Record<string, string> = {
      inbox: 'New tasks land here',
      active: 'Tasks run here',
      terminal: 'Completed tasks',
      none: 'Drop tasks here',
    };
    hint.textContent = hintMap[column.behavior] || 'Drop tasks here';
    cardsArea.appendChild(hint);
  }

  for (const task of tasks) {
    cardsArea.appendChild(createCardElement(task));
  }

  // Add task button at bottom
  const addBtn = document.createElement('button');
  addBtn.className = 'board-column-add';
  addBtn.textContent = '+ Add task';
  addBtn.addEventListener('click', () => {
    showTaskModal('create', undefined, column.id);
  });

  el.appendChild(header);
  el.appendChild(cardsArea);
  el.appendChild(addBtn);

  return el;
}

function showColumnContextMenu(x: number, y: number, column: BoardColumn): void {
  const board = getBoard();
  if (!board) return;

  const sorted = [...board.columns].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex(c => c.id === column.id);
  const isFirst = idx === 0;
  const isLast = idx === sorted.length - 1;
  const canDelete = column.behavior === 'none' && board.columns.length > 1;

  showContextMenu(x, y, [
    { label: 'Rename', action: () => {
      // Trigger inline rename on the column title
      const colEl = document.querySelector(`.board-column[data-column-id="${column.id}"]`);
      const titleSpan = colEl?.querySelector('.column-title') as HTMLElement | null;
      if (titleSpan) startInlineRename(titleSpan, column);
    }},
    { label: 'Add Column After', action: () => addColumn('New Column', column.id) },
    { label: 'Move Left', action: () => moveColumn(column.id, -1), disabled: isFirst },
    { label: 'Move Right', action: () => moveColumn(column.id, 1), disabled: isLast },
    { label: 'Delete Column', danger: true, action: () => confirmDeleteColumn(column), disabled: !canDelete },
  ]);
}

function moveColumn(columnId: string, direction: -1 | 1): void {
  const board = getBoard();
  if (!board) return;

  const sorted = [...board.columns].sort((a, b) => a.order - b.order);
  const ids = sorted.map(c => c.id);
  const idx = ids.indexOf(columnId);
  const swapIdx = idx + direction;
  if (swapIdx < 0 || swapIdx >= ids.length) return;

  // Swap
  [ids[idx], ids[swapIdx]] = [ids[swapIdx], ids[idx]];
  reorderColumns(ids);
}

function confirmDeleteColumn(column: BoardColumn): void {
  const board = getBoard();
  const taskCount = board?.tasks.filter(t => t.columnId === column.id).length ?? 0;
  const message = taskCount > 0
    ? `Delete column "${column.title}"? Its ${taskCount} task(s) will be moved to Backlog.`
    : `Delete column "${column.title}"?`;
  showConfirmModal('Delete Column', message, () => deleteColumn(column.id));
}

function startInlineRename(titleSpan: HTMLElement, column: BoardColumn): void {
  if (titleSpan.querySelector('input')) return;

  const input = document.createElement('input');
  input.className = 'column-title-input';
  input.value = column.title;
  input.maxLength = 40;

  titleSpan.textContent = '';
  titleSpan.appendChild(input);
  input.select();

  const commit = () => {
    const value = input.value.trim();
    if (value && value !== column.title) {
      renameColumn(column.id, value);
    } else {
      titleSpan.textContent = column.title;
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = column.title; input.blur(); }
  });
}
