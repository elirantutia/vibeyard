import { appState } from '../state.js';
import { onChange as onGitStatusChange, getGitStatus, getActiveGitPath, getWorktrees, setActiveWorktree, onWorktreeChange } from '../git-status.js';
import { onChange as onStatusChange } from '../session-activity.js';
import { showFileViewer } from './file-viewer.js';
import type { GitFileEntry, GitWorktree } from '../types.js';

const MAX_FILES = 100;

let collapsed = false;
let lastCountKey = '';
let lastFilesKey = '';
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function statusBadge(entry: GitFileEntry): string {
  const letterMap: Record<string, string> = {
    added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: '?', conflicted: 'U',
  };
  const letter = letterMap[entry.status] || '?';
  return `<span class="git-file-badge ${entry.status}">${letter}</span>`;
}

function groupLabel(area: string): string {
  switch (area) {
    case 'staged': return 'Staged';
    case 'working': return 'Changes';
    case 'untracked': return 'Untracked';
    case 'conflicted': return 'Conflicted';
    default: return area;
  }
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

  // Insert after header
  const header = container.querySelector('.config-section-header');
  if (header && header.nextSibling) {
    container.querySelector('.config-section')!.insertBefore(wrapper, header.nextSibling);
  }
}

function applyGitPanelVisibility(): void {
  const container = document.getElementById('git-panel');
  if (!container) return;
  const visible = appState.preferences.sidebarViews?.gitPanel ?? true;
  container.classList.toggle('hidden', !visible);
}

/** Debounced refresh — coalesces rapid-fire events into a single render */
function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refresh();
  }, 100);
}

async function refresh(): Promise<void> {
  const container = document.getElementById('git-panel');
  if (!container) return;

  applyGitPanelVisibility();

  const project = appState.activeProject;
  if (!project) {
    container.innerHTML = '';
    return;
  }

  const status = getGitStatus(project.id);
  if (!status || !status.isGitRepo) {
    container.innerHTML = '';
    return;
  }

  const total = status.staged + status.modified + status.untracked + status.conflicted;
  if (total === 0) {
    container.innerHTML = '';
    return;
  }

  const activeGitPath = getActiveGitPath(project.id);
  const worktrees = getWorktrees(project.id);
  const hasMultipleWorktrees = worktrees && worktrees.length > 1;

  // Find active worktree branch for header
  let headerSuffix = '';
  if (hasMultipleWorktrees) {
    const activeWt = worktrees!.find(w => w.path === activeGitPath);
    if (activeWt?.branch) {
      headerSuffix = ` · ${esc(activeWt.branch)}`;
    }
  }

  const headerHTML = `<span class="config-section-toggle ${collapsed ? 'collapsed' : ''}">&#x25BC;</span>Git Changes${headerSuffix}<span class="config-section-count">${total}</span>`;

  // Try to update existing section in-place instead of rebuilding
  const existingSection = container.querySelector('.config-section');
  if (existingSection) {
    // Update header in-place
    const existingHeader = existingSection.querySelector('.config-section-header');
    if (existingHeader) {
      existingHeader.innerHTML = headerHTML;
    }

    // Update worktree selector
    if (hasMultipleWorktrees) {
      renderWorktreeSelector(container, project);
    } else {
      const selector = container.querySelector('.git-worktree-selector');
      if (selector) selector.remove();
    }

    // Reload files if expanded
    if (!collapsed) {
      const body = existingSection.querySelector('.config-section-body') as HTMLElement | null;
      if (body) loadFiles(body, activeGitPath);
    }
    return;
  }

  // First render — build from scratch
  const section = document.createElement('div');
  section.className = 'config-section';

  const header = document.createElement('div');
  header.className = 'config-section-header';
  header.innerHTML = headerHTML;

  const body = document.createElement('div');
  body.className = `config-section-body${collapsed ? ' hidden' : ''}`;

  header.addEventListener('click', () => {
    collapsed = !collapsed;
    const toggle = header.querySelector('.config-section-toggle')!;
    toggle.classList.toggle('collapsed');
    body.classList.toggle('hidden');
    // Fetch files on expand
    if (!collapsed) loadFiles(body, activeGitPath);
  });

  section.appendChild(header);
  section.appendChild(body);

  container.innerHTML = '';
  container.appendChild(section);

  // Add worktree selector if multiple worktrees
  if (hasMultipleWorktrees) {
    renderWorktreeSelector(container, project);
  }

  if (!collapsed) {
    loadFiles(body, activeGitPath);
  }
}

async function loadFiles(body: HTMLElement, gitPath: string): Promise<void> {
  // Show loading only on first load (when body is empty)
  if (!body.hasChildNodes()) {
    body.innerHTML = '<div class="config-loading">Loading...</div>';
  }

  let files: GitFileEntry[];
  try {
    files = await window.claudeIde.git.getFiles(gitPath) as GitFileEntry[];
  } catch {
    body.innerHTML = '';
    lastFilesKey = '';
    return;
  }

  // Skip DOM rebuild if file list hasn't changed
  const filesKey = JSON.stringify(files);
  if (filesKey === lastFilesKey) return;
  lastFilesKey = filesKey;

  body.innerHTML = '';

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
    groupHeader.textContent = `${groupLabel(area)} (${group.length})`;
    body.appendChild(groupHeader);

    for (const entry of group) {
      if (rendered >= MAX_FILES) break;
      const item = document.createElement('div');
      item.className = 'config-item config-item-clickable';
      item.innerHTML = `${statusBadge(entry)}<span class="config-item-detail" title="${esc(entry.path)}">${esc(entry.path)}</span>`;
      item.addEventListener('click', () => showFileViewer(entry.path, entry.area, gitPath));
      body.appendChild(item);
      rendered++;
    }
    if (rendered >= MAX_FILES) break;
  }

  const remaining = files.length - rendered;
  if (remaining > 0) {
    const overflow = document.createElement('div');
    overflow.className = 'config-empty';
    overflow.textContent = `and ${remaining} more...`;
    body.appendChild(overflow);
  }
}

export function scrollToGitPanel(): void {
  const container = document.getElementById('git-panel');
  if (!container || !container.firstElementChild) return;
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Expand if collapsed
  if (collapsed) {
    collapsed = false;
    const toggle = container.querySelector('.config-section-toggle');
    const body = container.querySelector('.config-section-body');
    if (toggle) toggle.classList.remove('collapsed');
    if (body) {
      body.classList.remove('hidden');
      const project = appState.activeProject;
      if (project) loadFiles(body as HTMLElement, getActiveGitPath(project.id));
    }
  }
}

export function toggleGitPanel(): void {
  const container = document.getElementById('git-panel');
  if (!container || !container.firstElementChild) return;

  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  collapsed = !collapsed;
  const toggle = container.querySelector('.config-section-toggle');
  const body = container.querySelector('.config-section-body');
  if (toggle) toggle.classList.toggle('collapsed');
  if (body) {
    body.classList.toggle('hidden');
    if (!collapsed) {
      const project = appState.activeProject;
      if (project) loadFiles(body as HTMLElement, getActiveGitPath(project.id));
    }
  }
}

export function initGitPanel(): void {
  appState.on('project-changed', () => { lastFilesKey = ''; scheduleRefresh(); });
  appState.on('state-loaded', () => { lastFilesKey = ''; scheduleRefresh(); });

  // Refresh when git status counts change
  onGitStatusChange((projectId, status) => {
    if (projectId !== appState.activeProjectId) return;
    const key = `${status.staged}:${status.modified}:${status.untracked}:${status.conflicted}`;
    if (key !== lastCountKey) {
      lastCountKey = key;
      lastFilesKey = '';
      refresh();
    }
  });

  // Refresh on session working → waiting transition
  onStatusChange((_sessionId, status) => {
    if (status === 'waiting' || status === 'completed') {
      lastFilesKey = '';
      scheduleRefresh();
    }
  });

  // Refresh when worktree list or active worktree changes
  onWorktreeChange(() => { lastFilesKey = ''; scheduleRefresh(); });

  // Auto-switch on session change
  appState.on('session-changed', () => { lastFilesKey = ''; scheduleRefresh(); });
  appState.on('preferences-changed', () => applyGitPanelVisibility());
}
