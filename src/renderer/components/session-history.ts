import { appState, ArchivedSession } from '../state.js';

const MAX_VISIBLE = 50;
const PROVIDER_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  copilot: 'GitHub Copilot',
  gemini: 'Gemini CLI',
};

let container: HTMLElement;
let searchInput: HTMLInputElement;
let listEl: HTMLElement;
let collapsed = true;
let bookmarkFilterActive = false;

function applyHistoryVisibility(): void {
  if (!container) return;
  const featureEnabled = appState.preferences.sessionHistoryEnabled;
  const sidebarVisible = appState.preferences.sidebarViews?.sessionHistory ?? true;
  container.classList.toggle('hidden', !featureEnabled || !sidebarVisible);
}

export function initSessionHistory(): void {
  container = document.getElementById('session-history')!;
  render();

  appState.on('history-changed', onHistoryChanged);
  appState.on('project-changed', render);
  appState.on('state-loaded', render);
  appState.on('preferences-changed', () => applyHistoryVisibility());
}

function onHistoryChanged(): void {
  applyHistoryVisibility();

  const project = appState.activeProject;
  if (!collapsed && listEl && project) {
    const history = appState.getSessionHistory(project.id);
    // Update the count badge in the header
    const countEl = container.querySelector('.config-section-count');
    if (countEl) {
      countEl.textContent = String(history.length);
    } else if (history.length > 0) {
      const header = container.querySelector('.config-section-header');
      if (header) {
        const span = document.createElement('span');
        span.className = 'config-section-count';
        span.textContent = String(history.length);
        header.appendChild(span);
      }
    }
    renderList(history);
    return;
  }

  render();
}

function render(): void {
  applyHistoryVisibility();

  const project = appState.activeProject;
  const history = project ? appState.getSessionHistory(project.id) : [];

  if (!project) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'config-section-header';
  header.innerHTML = `
    <span class="config-section-toggle ${collapsed ? 'collapsed' : ''}">&#x25BC;</span>
    <span>History</span>
    ${history.length > 0 ? `<span class="config-section-count">${history.length}</span>` : ''}
  `;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    render();
  });
  container.appendChild(header);

  if (collapsed) return;

  const body = document.createElement('div');
  body.className = 'history-body';

  if (history.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'No session history yet';
    body.appendChild(empty);
    container.appendChild(body);
    return;
  }

  // Search
  searchInput = document.createElement('input');
  searchInput.className = 'history-search';
  searchInput.type = 'text';
  searchInput.placeholder = 'Filter history...';
  searchInput.addEventListener('input', () => renderList(history));
  body.appendChild(searchInput);

  // Bookmark filter
  const bookmarkFilter = document.createElement('button');
  const applyFilterState = () => {
    bookmarkFilter.className = `history-bookmark-filter${bookmarkFilterActive ? ' active' : ''}`;
    bookmarkFilter.textContent = bookmarkFilterActive ? '★ Bookmarked' : '☆ Bookmarked';
  };
  applyFilterState();
  bookmarkFilter.addEventListener('click', () => {
    bookmarkFilterActive = !bookmarkFilterActive;
    applyFilterState();
    renderList(history);
  });
  // Clear button
  const clearBtn = document.createElement('button');
  clearBtn.className = 'history-clear-btn';
  clearBtn.textContent = 'Clear History';
  clearBtn.addEventListener('click', () => {
    if (!project) return;
    appState.clearSessionHistory(project.id);
  });

  const actions = document.createElement('div');
  actions.className = 'history-actions';
  actions.appendChild(bookmarkFilter);
  actions.appendChild(clearBtn);
  body.appendChild(actions);

  // List
  listEl = document.createElement('div');
  listEl.className = 'history-list';
  body.appendChild(listEl);

  container.appendChild(body);
  renderList(history);
}

function renderList(history: ArchivedSession[]): void {
  const filter = searchInput?.value.toLowerCase() || '';
  const filtered = history
    .filter((a) => a.name.toLowerCase().includes(filter))
    .filter((a) => !bookmarkFilterActive || a.bookmarked)
    .reverse(); // newest first

  listEl.innerHTML = '';

  const visible = filtered.slice(0, MAX_VISIBLE);
  for (const archived of visible) {
    const item = document.createElement('div');
    item.className = 'history-item';

    if (archived.cliSessionId) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        const project = appState.activeProject;
        if (project) {
          appState.resumeFromHistory(project.id, archived.id);
        }
      });
    }

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
      const project = appState.activeProject;
      if (project) {
        appState.toggleBookmark(project.id, archived.id);
      }
    });
    actions.appendChild(bookmarkBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'history-remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove from history';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const project = appState.activeProject;
      if (project) {
        appState.removeHistoryEntry(project.id, archived.id);
      }
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
