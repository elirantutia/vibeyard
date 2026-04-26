import { appState, ArchivedSession, ProjectRecord } from '../state.js';
import { loadProviderAvailability } from '../provider-availability.js';
import { buildResumeWithProviderItems } from './resume-with-provider-menu.js';
import { showConfirmDialog } from './modal.js';
import type { ProviderId } from '../../shared/types.js';

const MAX_VISIBLE = 50;
const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  copilot: 'GitHub Copilot',
  gemini: 'Gemini CLI',
};

interface ProjectFilterState {
  searchText: string;
  bookmarkOnly: boolean;
}

const filterStateByProject = new Map<string, ProjectFilterState>();
const activePanels = new Map<string, HTMLElement>();

let historyContextMenu: HTMLElement | null = null;

function hideHistoryContextMenu(): void {
  if (historyContextMenu) {
    historyContextMenu.remove();
    historyContextMenu = null;
  }
}

function showHistoryContextMenu(x: number, y: number, project: ProjectRecord, archived: ArchivedSession): void {
  hideHistoryContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  if (archived.cliSessionId) {
    const resumeItem = document.createElement('div');
    resumeItem.className = 'tab-context-menu-item';
    resumeItem.textContent = 'Resume';
    resumeItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideHistoryContextMenu();
      appState.resumeFromHistory(project.id, archived.id);
    });
    menu.appendChild(resumeItem);
  }

  const resumeWithItems = buildResumeWithProviderItems(
    (archived.providerId || 'claude') as ProviderId,
    (targetId) => {
      hideHistoryContextMenu();
      appState.resumeWithProvider(project.id, { archivedSessionId: archived.id }, targetId);
    },
  );
  for (const el of resumeWithItems) menu.appendChild(el);

  if (!menu.firstChild) return;
  document.body.appendChild(menu);
  historyContextMenu = menu;
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

function getFilterState(projectId: string): ProjectFilterState {
  let state = filterStateByProject.get(projectId);
  if (!state) {
    state = { searchText: '', bookmarkOnly: false };
    filterStateByProject.set(projectId, state);
  }
  return state;
}

let listenersAttached = false;

export function initSessionHistory(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  appState.on('history-changed', rerenderAll);
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('click', hideHistoryContextMenu);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideHistoryContextMenu(); });
  }
}

function rerenderAll(): void {
  for (const [projectId, container] of activePanels) {
    const project = appState.projects.find(p => p.id === projectId);
    if (project) renderSessionHistory(project, container);
  }
}

export function renderSessionHistory(project: ProjectRecord, container: HTMLElement): void {
  activePanels.set(project.id, container);

  const history = appState.getSessionHistory(project.id);
  const filter = getFilterState(project.id);

  container.innerHTML = '';

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No session history yet';
    container.appendChild(empty);
    return;
  }

  const searchInput = document.createElement('input');
  searchInput.className = 'history-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'Filter history...';
  searchInput.value = filter.searchText;
  searchInput.addEventListener('input', () => {
    filter.searchText = searchInput.value;
    renderList(project, container, history, filter);
  });
  container.appendChild(searchInput);

  const bookmarkFilter = document.createElement('button');
  const applyFilterState = () => {
    bookmarkFilter.className = `history-bookmark-filter${filter.bookmarkOnly ? ' active' : ''}`;
    bookmarkFilter.textContent = filter.bookmarkOnly ? '★ Bookmarked' : '☆ Bookmarked';
  };
  applyFilterState();
  bookmarkFilter.addEventListener('click', () => {
    filter.bookmarkOnly = !filter.bookmarkOnly;
    applyFilterState();
    renderList(project, container, history, filter);
  });

  const clearBtn = document.createElement('button');
  clearBtn.className = 'history-clear-btn';
  clearBtn.textContent = 'Clear History';
  clearBtn.addEventListener('click', () => {
    showConfirmDialog(
      'Clear session history',
      `Clear all non-bookmarked sessions for "${project.name}"? Bookmarked sessions will be kept. This cannot be undone.`,
      {
        confirmLabel: 'Clear',
        onConfirm: () => appState.clearSessionHistory(project.id),
      },
    );
  });

  const actions = document.createElement('div');
  actions.className = 'history-actions';
  actions.appendChild(bookmarkFilter);
  actions.appendChild(clearBtn);
  container.appendChild(actions);

  const listEl = document.createElement('div');
  listEl.className = 'history-list';
  container.appendChild(listEl);

  renderList(project, container, history, filter);
}

export function closeSessionHistory(projectId: string): void {
  const container = activePanels.get(projectId);
  if (container) container.innerHTML = '';
  activePanels.delete(projectId);
}

export function clearProjectState(projectId: string): void {
  filterStateByProject.delete(projectId);
  activePanels.delete(projectId);
}

function renderList(
  project: ProjectRecord,
  container: HTMLElement,
  history: ArchivedSession[],
  filter: ProjectFilterState,
): void {
  const listEl = container.querySelector('.history-list') as HTMLElement | null;
  if (!listEl) return;

  const needle = filter.searchText.toLowerCase();
  const filtered = history
    .filter((a) => a.name.toLowerCase().includes(needle))
    .filter((a) => !filter.bookmarkOnly || a.bookmarked)
    .slice()
    .reverse();

  listEl.innerHTML = '';

  const visible = filtered.slice(0, MAX_VISIBLE);
  for (const archived of visible) {
    const item = document.createElement('div');
    item.className = 'history-item';

    if (archived.cliSessionId) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        appState.resumeFromHistory(project.id, archived.id);
      });
    }
    item.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      loadProviderAvailability().catch(() => {});
      showHistoryContextMenu(e.clientX, e.clientY, project, archived);
    });

    const info = document.createElement('div');
    info.className = 'history-item-info';

    const name = document.createElement('div');
    name.className = 'history-item-name';
    name.textContent = archived.name;
    name.title = archived.cliSessionId
      ? `${archived.name}\nSession ID: ${archived.cliSessionId}`
      : archived.name;
    info.appendChild(name);

    const details = document.createElement('div');
    details.className = 'history-item-details';
    const parts: string[] = [];
    parts.push(formatDate(archived.closedAt));
    if (archived.cost) {
      parts.push(`$${archived.cost.totalCostUsd.toFixed(2)}`);
    }
    parts.push(getProviderLabel(archived.providerId));
    details.textContent = parts.join(' · ');
    info.appendChild(details);

    item.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'history-item-actions';

    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = `history-bookmark-btn${archived.bookmarked ? ' bookmarked' : ''}`;
    bookmarkBtn.innerHTML = archived.bookmarked ? '&#9733;' : '&#9734;';
    bookmarkBtn.title = archived.bookmarked ? 'Remove bookmark' : 'Bookmark session';
    bookmarkBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      appState.toggleBookmark(project.id, archived.id);
    });
    actions.appendChild(bookmarkBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'history-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove from history';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      appState.removeHistoryEntry(project.id, archived.id);
    });
    actions.appendChild(removeBtn);

    item.appendChild(actions);

    listEl.appendChild(item);
  }

  if (filtered.length > MAX_VISIBLE) {
    const more = document.createElement('div');
    more.className = 'history-item-details';
    more.style.padding = '4px 12px';
    more.textContent = `${filtered.length - MAX_VISIBLE} more items...`;
    listEl.appendChild(more);
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getProviderLabel(providerId: string): string {
  return PROVIDER_LABELS[providerId] ?? providerId;
}
