import { appState, ProjectRecord } from '../state.js';
import { onChange as onGitStatusChange, gitChangeCount, getActiveGitPath, getWorktrees, setActiveWorktree, onWorktreeChange } from '../git-status.js';
import { onChange as onStatusChange } from '../session-activity.js';
import { showFileViewer } from './file-viewer.js';
import { areaLabel } from '../dom-utils.js';
import type { GitFileEntry } from '../types.js';

const MAX_FILES = 100;

let lastCountKey = '';
let lastFilesKey = '';
// git path whose changes are currently rendered — drives the cold-load loader
let displayedGitPath: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let activeContextMenu: HTMLElement | null = null;

// The git panel is a persistent DOM node reparented into the active project card
// whenever its "Git" tab is open. Keeping a single node (rather than rebuilding
// it on every sidebar render) preserves the rendered file rows + scroll position
// and lets loadFiles' cold-load/skip logic work across re-renders.
let gitPanelEl: HTMLElement | null = null;
let mountedProjectId: string | null = null;

function hideGitContextMenu(): void {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
}

function createMenuItem(label: string, onClick: () => void, disabled = false): HTMLElement {
  const item = document.createElement('div');
  item.className = 'tab-context-menu-item' + (disabled ? ' disabled' : '');
  item.textContent = label;
  if (!disabled) {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      hideGitContextMenu();
      onClick();
    });
  }
  return item;
}

function createSeparator(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'tab-context-menu-separator';
  return sep;
}

function afterAction(): void {
  lastFilesKey = '';
  scheduleRefresh();
}

function showGitFileContextMenu(x: number, y: number, entry: GitFileEntry, gitPath: string): void {
  hideGitContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  if (entry.area === 'staged') {
    menu.appendChild(createMenuItem('Unstage', async () => {
      await window.vibeyard.git.unstageFile(gitPath, entry.path);
      afterAction();
    }));
  } else {
    menu.appendChild(createMenuItem('Stage', async () => {
      await window.vibeyard.git.stageFile(gitPath, entry.path);
      afterAction();
    }));
  }

  if (entry.area !== 'staged' && entry.area !== 'conflicted') {
    menu.appendChild(createMenuItem('Discard Changes', async () => {
      const msg = discardConfirmMessage(entry);
      if (confirm(msg)) {
        await window.vibeyard.git.discardFile(gitPath, entry.path, entry.area);
        afterAction();
      }
    }));
  }

  menu.appendChild(createSeparator());

  menu.appendChild(createMenuItem('Open in Editor', async () => {
    await window.vibeyard.git.openInEditor(gitPath, entry.path);
  }));

  menu.appendChild(createMenuItem('Copy Path', () => {
    navigator.clipboard.writeText(entry.path);
  }));

  document.body.appendChild(menu);
  activeContextMenu = menu;

  // Adjust if menu goes off-screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}


function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function discardConfirmMessage(entry: GitFileEntry): string {
  if (entry.area !== 'untracked') {
    return `Discard changes to "${entry.path}"? This cannot be undone.`;
  }
  const kind = entry.path.endsWith('/') ? 'folder' : 'file';
  return `Delete untracked ${kind} "${entry.path}"?`;
}

function statusBadge(entry: GitFileEntry): string {
  const letterMap: Record<string, string> = {
    added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: '?', conflicted: 'U',
  };
  const letter = letterMap[entry.status] || '?';
  return `<span class="git-file-badge ${entry.status}">${letter}</span>`;
}

function createActionButton(title: string, icon: string, onClick: (e: Event) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'git-action-btn';
  btn.title = title;
  btn.textContent = icon;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return btn;
}


function shortPath(fullPath: string): string {
  const parts = fullPath.split('/');
  return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : fullPath;
}

function renderWorktreeSelector(container: HTMLElement, project: { id: string; path: string }): void {
  const worktrees = getWorktrees(project.id);
  // Remove existing selector
  const existing = container.querySelector('.git-worktree-selector');
  if (existing) existing.remove();

  if (!worktrees || worktrees.length <= 1) return;

  const activeGitPath = getActiveGitPath(project.id);

  const wrapper = document.createElement('div');
  wrapper.className = 'git-worktree-selector';

  const select = document.createElement('select');
  select.className = 'git-worktree-select';

  for (const wt of worktrees) {
    if (wt.isBare) continue;
    const option = document.createElement('option');
    option.value = wt.path;
    const label = wt.branch || `detached (${wt.head.slice(0, 7)})`;
    const pathHint = wt.path === project.path ? '' : ` — ${shortPath(wt.path)}`;
    option.textContent = label + pathHint;
    option.selected = wt.path === activeGitPath;
    select.appendChild(option);
  }

  select.addEventListener('change', () => {
    setActiveWorktree(project.id, select.value);
  });

  wrapper.appendChild(select);

  // Sits at the top of the mount, above the file list.
  container.insertBefore(wrapper, container.firstChild);
}

/** Debounced refresh — coalesces rapid-fire events into a single render */
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshMounted();
  }, 100);
}

/**
 * Mount the persistent git panel node into `container` (the active project
 * card's `.project-panel-git`) and (re)load its contents. Reparenting the same
 * node keeps its DOM state intact across sidebar re-renders.
 */
export function mountGitPanel(project: ProjectRecord, container: HTMLElement): void {
  const isNewMount = !gitPanelEl || mountedProjectId !== project.id;
  if (!gitPanelEl) {
    gitPanelEl = document.createElement('div');
    gitPanelEl.className = 'git-panel-mount';
  }
  mountedProjectId = project.id;
  container.appendChild(gitPanelEl);
  // Reparenting preserves the existing rows; only (re)load on first mount or a
  // project switch. Live updates arrive via the git-status subscriptions, so a
  // plain sidebar re-render must not trigger a redundant getFiles IPC.
  if (isNewMount) refreshMounted();
}

/** Detach the panel and stop background reloads (the tab was closed). */
export function closeGitPanel(): void {
  mountedProjectId = null;
  if (gitPanelEl) gitPanelEl.remove();
}

/** Rebuild/update the mounted panel's contents for the active project. */
function refreshMounted(): void {
  // Guard on mount state, not DOM connectivity: mountGitPanel renders the node
  // before the sidebar attaches it to the document, so isConnected is still
  // false on the first paint. mountedProjectId is null only when the tab is
  // closed, which is exactly when background refreshes should no-op.
  if (!gitPanelEl || mountedProjectId === null) return;
  const project = appState.activeProject;
  if (!project || project.id !== mountedProjectId) return;

  const worktrees = getWorktrees(project.id);
  if (worktrees && worktrees.length > 1) {
    renderWorktreeSelector(gitPanelEl, project);
  } else {
    const selector = gitPanelEl.querySelector('.git-worktree-selector');
    if (selector) selector.remove();
  }

  let body = gitPanelEl.querySelector('.git-panel-body') as HTMLElement | null;
  if (!body) {
    body = document.createElement('div');
    body.className = 'config-section-body git-panel-body';
    gitPanelEl.appendChild(body);
  }

  const total = gitChangeCount(project.id);
  if (total === null || total === 0) {
    body.innerHTML = '<div class="config-empty">No uncommitted changes</div>';
    lastFilesKey = '';
    displayedGitPath = null;
    return;
  }

  loadFiles(body, getActiveGitPath(project.id));
}

async function loadFiles(body: HTMLElement, gitPath: string): Promise<void> {
  // Show a loader on cold load only — first ever, or when switching to a
  // different project/worktree (stale rows from the previous path are still
  // showing). Background refreshes of the same path stay silent.
  if (!body.hasChildNodes() || gitPath !== displayedGitPath) {
    body.innerHTML = '<div class="config-loading git-loading"><span class="git-loading-spinner"></span>Loading changes…</div>';
    lastFilesKey = '';
  }

  let files: GitFileEntry[];
  try {
    files = await window.vibeyard.git.getFiles(gitPath) as GitFileEntry[];
  } catch {
    body.innerHTML = '';
    lastFilesKey = '';
    displayedGitPath = null;
    return;
  }

  // Skip DOM rebuild if file list hasn't changed
  const filesKey = JSON.stringify(files);
  if (filesKey === lastFilesKey) return;
  lastFilesKey = filesKey;
  displayedGitPath = gitPath;

  const fragment = document.createDocumentFragment();

  // Group by area in display order
  const order: string[] = ['conflicted', 'staged', 'working', 'untracked'];
  const groups = new Map<string, GitFileEntry[]>();
  for (const f of files) {
    const list = groups.get(f.area) || [];
    list.push(f);
    groups.set(f.area, list);
  }

  let rendered = 0;
  for (const area of order) {
    const group = groups.get(area);
    if (!group || group.length === 0) continue;

    const groupHeader = document.createElement('div');
    groupHeader.className = 'git-group-header';
    groupHeader.textContent = `${areaLabel(area)} (${group.length})`;
    fragment.appendChild(groupHeader);

    for (const entry of group) {
      if (rendered >= MAX_FILES) break;
      const item = document.createElement('div');
      item.className = 'config-item config-item-clickable';
      item.innerHTML = `${statusBadge(entry)}<span class="config-item-detail" title="${esc(entry.path)}">${esc(entry.path)}</span>`;

      // Hover action buttons
      const actions = document.createElement('span');
      actions.className = 'git-item-actions';

      if (entry.area === 'staged') {
        actions.appendChild(createActionButton('Unstage', '−', async () => {
          await window.vibeyard.git.unstageFile(gitPath, entry.path);
          afterAction();
        }));
      } else {
        if (entry.area !== 'conflicted') {
          actions.appendChild(createActionButton('Discard Changes', '↩', async () => {
            const msg = discardConfirmMessage(entry);
            if (confirm(msg)) {
              await window.vibeyard.git.discardFile(gitPath, entry.path, entry.area);
              afterAction();
            }
          }));
        }
        actions.appendChild(createActionButton('Stage', '+', async () => {
          await window.vibeyard.git.stageFile(gitPath, entry.path);
          afterAction();
        }));
      }

      item.appendChild(actions);

      item.addEventListener('click', () => showFileViewer(entry.path, entry.area, gitPath));
      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showGitFileContextMenu(e.clientX, e.clientY, entry, gitPath);
      });
      fragment.appendChild(item);
      rendered++;
    }
    if (rendered >= MAX_FILES) break;
  }

  const remaining = files.length - rendered;
  if (remaining > 0) {
    const overflow = document.createElement('div');
    overflow.className = 'config-empty';
    overflow.textContent = `and ${remaining} more...`;
    fragment.appendChild(overflow);
  }

  body.innerHTML = '';
  body.appendChild(fragment);
}

export function initGitPanel(): void {
  document.addEventListener('click', hideGitContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideGitContextMenu(); });

  appState.on('project-changed', () => { lastFilesKey = ''; scheduleRefresh(); });
  appState.on('state-loaded', () => { lastFilesKey = ''; scheduleRefresh(); });

  // Refresh when git status counts change
  onGitStatusChange((projectId, status) => {
    if (projectId !== appState.activeProjectId) return;
    const key = `${status.staged}:${status.modified}:${status.untracked}:${status.conflicted}`;
    if (key !== lastCountKey) {
      lastCountKey = key;
      lastFilesKey = '';
      refreshMounted();
    }
  });

  // Refresh on session working → waiting transition (don't clear lastFilesKey —
  // poll() in git-status.ts handles that when status actually changes)
  onStatusChange((_sessionId, status) => {
    if (status === 'waiting' || status === 'completed') {
      scheduleRefresh();
    }
  });

  // Refresh when worktree list or active worktree changes
  onWorktreeChange(() => { lastFilesKey = ''; scheduleRefresh(); });

  appState.on('session-changed', () => { scheduleRefresh(); });
}

// --- Test-only exports ---
export const _test = { loadFiles };
export function _resetForTesting(): void {
  lastCountKey = '';
  lastFilesKey = '';
  displayedGitPath = null;
  gitPanelEl = null;
  mountedProjectId = null;
}
