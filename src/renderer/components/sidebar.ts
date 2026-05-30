import { appState, MAX_PROJECT_NAME_LENGTH, ProjectRecord } from '../state.js';
import { showModal, setModalError, closeModal, showConfirmDialog } from './modal.js';
import { showPreferencesModal } from './preferences-modal.js';
import { onChange as onCostChange, getAggregateCost } from '../session-cost.js';
import { hasUnreadInProject, onChange as onUnreadChange } from '../session-unread.js';
import { onChange as onActivityChange } from '../session-activity.js';
import { getProjectStatus, projectInitial } from '../project-status.js';
import { init as initDiscussionsBadge, getNewCount as getDiscussionsNewCount, markSeen as markDiscussionsSeen, onChange as onDiscussionsChange, DISCUSSIONS_URL } from '../discussions-badge.js';
import { basename, lastSeparatorIndex } from '../../shared/platform.js';
import { deriveProjectName } from '../../shared/project-name.js';
import { esc, scoreColor } from '../dom-utils.js';
import { renderFileTree, clearProjectState as clearFileTreeState, closeFileTree } from './file-tree.js';
import {
  renderSessionHistory,
  closeSessionHistory,
  clearProjectState as clearSessionHistoryState,
} from './session-history.js';
import { attachHoverCard } from './hover-card.js';

type ProjectPanel = 'history' | 'files' | null;
const projectPanelOpen = new Map<string, ProjectPanel>();

const projectListEl = document.getElementById('project-list')!;
let activeProjectContextMenu: HTMLElement | null = null;
let renamingProjectId: string | null = null;
const btnAddProject = document.getElementById('btn-add-project')!;
const btnPreferences = document.getElementById('btn-preferences')!;
const sidebarEl = document.getElementById('sidebar')!;
const resizeHandle = document.getElementById('sidebar-resize-handle')!;

const sidebarFooterEl = document.getElementById('sidebar-footer')!;
const sidebarDiscussionsEl = document.getElementById('sidebar-discussions')!;
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar')!;

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 500;

const svgIcon = (inner: string): string =>
  `<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICON_KANBAN = '<svg viewBox="160 -800 640 640" width="14" height="14" fill="currentColor"><path d="M300-300h40v-360h-40v360Zm320-80h40v-280h-40v280ZM460-500h40v-160h-40v160ZM224.62-160q-27.62 0-46.12-18.5Q160-197 160-224.62v-510.76q0-27.62 18.5-46.12Q197-800 224.62-800h510.76q27.62 0 46.12 18.5Q800-763 800-735.38v510.76q0 27.62-18.5 46.12Q763-160 735.38-160H224.62Zm0-40h510.76q9.24 0 16.93-7.69 7.69-7.69 7.69-16.93v-510.76q0-9.24-7.69-16.93-7.69-7.69-16.93-7.69H224.62q-9.24 0-16.93 7.69-7.69 7.69-7.69 16.93v510.76q0 9.24 7.69 16.93 7.69 7.69 16.93 7.69ZM200-760v560-560Z"/></svg>';
const ICON_SESSIONS = svgIcon('<circle cx="7" cy="7" r="5.5"/><path d="M7 4v3l2 1.5"/>');
const ICON_TEAM = '<svg viewBox="100 -760 760 580" width="14" height="14" fill="currentColor"><path d="M103.85-215.38v-65.85q0-27.85 14.42-47.89 14.42-20.03 38.76-32.02 52.05-24.78 103.35-39.51 51.31-14.73 123.47-14.73 72.15 0 123.46 14.73 51.31 14.73 103.35 39.51 24.34 11.99 38.76 32.02 14.43 20.04 14.43 47.89v65.85h-560Zm640 0v-67.7q0-34.77-14.08-65.64-14.07-30.87-39.92-52.97 29.46 6 56.77 16.65 27.3 10.66 54 23.96 26 13.08 40.77 33.47 14.76 20.4 14.76 44.53v67.7h-112.3ZM298.92-539.69q-35.07-35.08-35.07-84.93 0-49.84 35.07-84.92 35.08-35.08 84.93-35.08 49.84 0 84.92 35.08t35.08 84.92q0 49.85-35.08 84.93-35.08 35.07-84.92 35.07-49.85 0-84.93-35.07Zm340.45 0q-35.25 35.07-84.75 35.07-2.54 0-6.47-.57-3.92-.58-6.46-1.27 20.33-24.9 31.24-55.24 10.92-30.34 10.92-63.01t-11.43-62.44q-11.42-29.77-30.73-55.62 3.23-1.15 6.46-1.5 3.23-.35 6.47-.35 49.5 0 84.75 35.08t35.25 84.92q0 49.85-35.25 84.93ZM143.85-255.38h480v-25.85q0-14.08-7.04-24.62-7.04-10.53-25.27-20.15-44.77-23.92-94.39-36.65-49.61-12.73-113.3-12.73-63.7 0-113.31 12.73-49.62 12.73-94.39 36.65-18.23 9.62-25.27 20.15-7.03 10.54-7.03 24.62v25.85Zm296.5-312.74q23.5-23.5 23.5-56.5t-23.5-56.5q-23.5-23.5-56.5-23.5t-56.5 23.5q-23.5 23.5-23.5 56.5t23.5 56.5q23.5 23.5 56.5 23.5t56.5-23.5Zm-56.5 312.74Zm0-369.24Z"/></svg>';
const ICON_FILES = svgIcon('<path d="M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/>');
const ICON_OVERVIEW = '<svg viewBox="160 -800 640 640" width="14" height="14" fill="currentColor"><path d="M224.62-160q-26.85 0-45.74-18.88Q160-197.77 160-224.62v-510.76q0-26.85 18.88-45.74Q197.77-800 224.62-800h510.76q26.85 0 45.74 18.88Q800-762.23 800-735.38v510.76q0 26.85-18.88 45.74Q762.23-160 735.38-160H224.62ZM420-200v-260H200v235.38q0 10.77 6.92 17.7 6.93 6.92 17.7 6.92H420Zm40 0h275.38q10.77 0 17.7-6.92 6.92-6.93 6.92-17.7V-460H460v260ZM200-500h560v-235.38q0-10.77-6.92-17.7-6.93-6.92-17.7-6.92H224.62q-10.77 0-17.7 6.92-6.92 6.93-6.92 17.7V-500Z"/></svg>';
const ICON_DISCUSSIONS = '<svg viewBox="0 -960 960 960" width="14" height="14" fill="currentColor"><path d="m240-240-92 92q-19 19-43.5 8.5T80-177v-623q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240Zm-34-80h594v-480H160v525l46-45Zm-46 0v-480 480Zm120-80h240q17 0 28.5-11.5T560-440q0-17-11.5-28.5T520-480H280q-17 0-28.5 11.5T240-440q0 17 11.5 28.5T280-400Zm0-120h400q17 0 28.5-11.5T720-560q0-17-11.5-28.5T680-600H280q-17 0-28.5 11.5T240-560q0 17 11.5 28.5T280-520Zm0-120h400q17 0 28.5-11.5T720-680q0-17-11.5-28.5T680-720H280q-17 0-28.5 11.5T240-680q0 17 11.5 28.5T280-640Z"/></svg>';

export function toggleSidebar(): void {
  appState.toggleSidebar();
}

function applySidebarCollapsed(): void {
  const collapsed = appState.sidebarCollapsed;
  sidebarEl.classList.toggle('collapsed', collapsed);
  resizeHandle.style.display = collapsed ? 'none' : '';
}

export function initSidebar(): void {
  btnAddProject.addEventListener('click', promptNewProject);
  btnPreferences.addEventListener('click', showPreferencesModal);
  btnToggleSidebar.addEventListener('click', toggleSidebar);

  renderDiscussions();
  applyDiscussionsVisibility();
  sidebarDiscussionsEl.addEventListener('click', () => {
    markDiscussionsSeen();
    window.vibeyard.app.openExternal(DISCUSSIONS_URL);
  });
  initDiscussionsBadge();
  onDiscussionsChange(renderDiscussions);

  initResizeHandle();
  appState.on('state-loaded', () => {
    if (appState.sidebarWidth) {
      sidebarEl.style.width = appState.sidebarWidth + 'px';
    }
    applySidebarCollapsed();
    render();
  });
  appState.on('sidebar-toggled', applySidebarCollapsed);
  appState.on('project-added', render);
  appState.on('project-removed', (id) => {
    if (typeof id === 'string') {
      projectPanelOpen.delete(id);
      clearFileTreeState(id);
      clearSessionHistoryState(id);
    }
    render();
  });
  appState.on('project-changed', render);
  appState.on('session-added', render);
  appState.on('session-removed', render);
  appState.on('layout-changed', render);
  appState.on('readiness-changed', render);


  onCostChange(() => {
    renderCostFooter();
  });

  onUnreadChange(render);
  // Status ticks are frequent — update just the affected row's dot rather than
  // rebuilding the whole list (mirrors the tab-bar's surgical update).
  onActivityChange((sessionId) => {
    const project = appState.projects.find((p) => p.sessions.some((s) => s.id === sessionId));
    if (!project || project.id === appState.activeProjectId) return;
    const dot = projectListEl.querySelector(
      `.project-item[data-project-id="${project.id}"] .project-status`,
    );
    if (dot) dot.className = `project-status ${getProjectStatus(project)}`;
  });
  appState.on('preferences-changed', () => {
    applyCostFooterVisibility();
    applyDiscussionsVisibility();
    render();
  });

  document.addEventListener('click', hideProjectContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideProjectContextMenu(); });

  render();
}

interface RenderOpts {
  fileTreeEnabled: boolean;
  historyEnabled: boolean;
}

function render(): void {
  if (renamingProjectId) return;
  hideProjectContextMenu();
  projectListEl.innerHTML = '';

  const opts: RenderOpts = {
    fileTreeEnabled: appState.preferences.sidebarViews?.fileTree ?? true,
    historyEnabled:
      (appState.preferences.sidebarViews?.sessionHistory ?? true) &&
      appState.preferences.sessionHistoryEnabled,
  };

  // The active project is pinned to the top as a card; the rest follow under an
  // "All projects" label (mirroring the Foundation sidebar layout).
  const active = appState.projects.find((p) => p.id === appState.activeProjectId);
  const others = appState.projects.filter((p) => p.id !== appState.activeProjectId);

  if (active) {
    projectListEl.appendChild(buildProjectRow(active, true, opts));
  }
  if (others.length) {
    if (active) {
      const label = document.createElement('div');
      label.className = 'sidebar-section-label';
      label.textContent = 'All projects';
      projectListEl.appendChild(label);
    }
    for (const project of others) {
      projectListEl.appendChild(buildProjectRow(project, false, opts));
    }
  }
}

function buildProjectRow(project: ProjectRecord, isActive: boolean, opts: RenderOpts): HTMLElement {
  const { fileTreeEnabled, historyEnabled } = opts;

  const wrapper = document.createElement('div');
  // The wrapper carries `.active` so CSS can style the whole row (header + tabs
  // + panel) as one card without a `:has()` selector.
  wrapper.className = 'project-row' + (isActive ? ' active' : '');

  const el = document.createElement('div');
  el.className = 'project-item' + (isActive ? ' active' : '');
  el.dataset.projectId = project.id;
  el.draggable = true;
  // Leading glyph: the active project shows an avatar initial; others show a
  // status dot reflecting their aggregate session activity.
  const lead = isActive
    ? `<div class="project-avatar" aria-hidden="true">${esc(projectInitial(project.name))}</div>`
    : `<span class="project-status ${getProjectStatus(project)}" aria-hidden="true"></span>`;
  const countPill = project.sessions.length
    ? `<span class="project-session-count">${project.sessions.length}</span>`
    : '';
  el.innerHTML = `
    ${lead}
    <div class="project-main">
      <div class="project-name${hasUnreadInProject(project.id) ? ' unread' : ''}">${esc(project.name)}</div>
      <div class="project-path">${esc(project.path)}</div>
    </div>
    ${countPill}
    <span class="project-delete" title="Remove project">&times;</span>
  `;

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('project-delete')) return;
    if (isActive) return;
    appState.setActiveProject(project.id);
  });

  el.querySelector('.project-delete')!.addEventListener('click', () => {
    confirmRemoveProject(project);
  });

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showProjectContextMenu(e.clientX, e.clientY, project);
  });

  el.addEventListener('dragstart', (e) => {
    if (renamingProjectId === project.id) {
      e.preventDefault();
      return;
    }
    e.dataTransfer!.effectAllowed = 'move';
    e.dataTransfer!.setData('text/plain', project.id);
    el.classList.add('dragging');
  });

  el.addEventListener('dragover', (e) => {
    if (el.classList.contains('dragging')) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    el.classList.remove('drag-over-top', 'drag-over-bottom');
    if (e.clientY < midY) {
      el.classList.add('drag-over-top');
    } else {
      el.classList.add('drag-over-bottom');
    }
  });

  el.addEventListener('dragleave', () => {
    el.classList.remove('drag-over-top', 'drag-over-bottom');
  });

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag-over-top', 'drag-over-bottom');
    const draggedId = e.dataTransfer!.getData('text/plain');
    if (!draggedId || draggedId === project.id) return;

    const fromIndex = appState.projects.findIndex(p => p.id === draggedId);
    if (fromIndex === -1) return;

    const rect = el.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    let targetIndex = appState.projects.findIndex(p => p.id === project.id);
    if (e.clientY >= midY) targetIndex++;
    // Adjust for the fact that removing the dragged item shifts indices
    if (fromIndex < targetIndex) targetIndex--;

    appState.reorderProject(fromIndex, targetIndex);
  });

  el.addEventListener('dragend', () => {
    projectListEl.querySelectorAll('.project-item.dragging, .project-item.drag-over-top, .project-item.drag-over-bottom').forEach(node => {
      node.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
    });
  });

  wrapper.appendChild(el);

  if (isActive) {
    const openPanel = projectPanelOpen.get(project.id) ?? null;
    const actions = buildProjectActions(project, openPanel, { fileTreeEnabled, historyEnabled });
    wrapper.appendChild(actions);

    if (openPanel !== null) {
      const panelContainer = document.createElement('div');
      panelContainer.className = 'project-panel';
      if (openPanel === 'files') {
        panelContainer.classList.add('project-panel-files', 'project-file-tree');
        renderFileTree(project, panelContainer);
      } else {
        panelContainer.classList.add('project-panel-history');
        renderSessionHistory(project, panelContainer);
      }
      wrapper.appendChild(panelContainer);
    }
  }

  return wrapper;
}

function buildProjectActions(
  project: ProjectRecord,
  openPanel: ProjectPanel,
  opts: { fileTreeEnabled: boolean; historyEnabled: boolean },
): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'project-actions';

  const overviewBtn = makeActionButton('Overview', ICON_OVERVIEW, false);
  const readinessScore = project.readiness?.overallScore;
  if (typeof readinessScore === 'number') {
    overviewBtn.classList.add('has-readiness');
    overviewBtn.style.setProperty('--readiness-color', scoreColor(readinessScore));
  }
  overviewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.openProjectTab(project.id);
  });
  actions.appendChild(overviewBtn);

  const kanbanBtn = makeActionButton('Kanban', ICON_KANBAN, false);
  kanbanBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.openKanbanTab(project.id);
  });
  actions.appendChild(kanbanBtn);

  if (opts.historyEnabled) {
    const historyBtn = makeActionButton('Sessions', ICON_SESSIONS, openPanel === 'history');
    historyBtn.classList.add('panel-toggle');
    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setProjectPanel(project.id, openPanel === 'history' ? null : 'history');
    });
    actions.appendChild(historyBtn);
  }

  const teamBtn = makeActionButton('Team', ICON_TEAM, false);
  teamBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.openTeamTab(project.id);
  });
  actions.appendChild(teamBtn);

  if (opts.fileTreeEnabled) {
    const filesBtn = makeActionButton('Files', ICON_FILES, openPanel === 'files');
    filesBtn.classList.add('panel-toggle');
    filesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setProjectPanel(project.id, openPanel === 'files' ? null : 'files');
    });
    actions.appendChild(filesBtn);
  }

  return actions;
}

function makeActionButton(label: string, iconSvg: string, active: boolean, hint?: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'project-action-btn' + (active ? ' active' : '');
  btn.innerHTML = `<span class="action-icon" aria-hidden="true">${iconSvg}</span><span class="action-label">${esc(label)}</span>`;
  attachHoverCard(btn, hint ?? label);
  return btn;
}

function setProjectPanel(projectId: string, next: ProjectPanel): void {
  const current = projectPanelOpen.get(projectId) ?? null;
  if (current === 'files' && next !== 'files') closeFileTree(projectId);
  if (current === 'history' && next !== 'history') closeSessionHistory(projectId);
  if (next === null) {
    projectPanelOpen.delete(projectId);
  } else {
    projectPanelOpen.set(projectId, next);
  }
  render();
}

export function promptNewProject(): void {
  showModal('New Project', [
    { label: 'Name', id: 'project-name', placeholder: 'My Project' },
    {
      label: 'Path', id: 'project-path', placeholder: '/path/to/project',
      buttonLabel: 'Browse',
      onButtonClick: async (input) => {
        const dir = await window.vibeyard.fs.browseDirectory();
        if (!dir) return;
        input.value = dir;
        autoFillName(dir);
      },
    },
  ], async (values) => {
    const name = values['project-name']?.trim();
    const rawPath = values['project-path']?.trim();
    if (!name || !rawPath) return;

    const projectPath = await window.vibeyard.fs.expandPath(rawPath);
    const isDir = await window.vibeyard.fs.isDirectory(projectPath);
    if (!isDir) {
      setModalError('project-path', 'Directory does not exist');
      return;
    }

    closeModal();
    appState.addProject(name, projectPath);
  });

  const nameInput = document.getElementById('modal-project-name') as HTMLInputElement | null;
  let nameManuallyEdited = false;
  nameInput?.addEventListener('input', () => { nameManuallyEdited = true; });

  const autoFillName = (path: string) => {
    if (nameInput && !nameManuallyEdited) {
      nameInput.value = deriveProjectName(path);
    }
  };

  // Attach path autocomplete to the rendered input
  const pathInput = document.getElementById('modal-project-path') as HTMLInputElement | null;
  if (pathInput) {
    const fieldRow = pathInput.parentElement!;
    fieldRow.style.position = 'relative';
    fieldRow.style.flexWrap = 'wrap';

    const dropdown = document.createElement('div');
    dropdown.className = 'path-autocomplete-dropdown';
    fieldRow.appendChild(dropdown);

    let activeIndex = -1;

    const hideDropdown = () => {
      dropdown.innerHTML = '';
      dropdown.classList.remove('visible');
      activeIndex = -1;
    };

    const showSuggestions = (dirs: string[], dirPart: string) => {
      dropdown.innerHTML = '';
      activeIndex = -1;
      if (dirs.length === 0) { hideDropdown(); return; }
      for (const dir of dirs) {
        const item = document.createElement('div');
        item.className = 'path-autocomplete-item';
        item.textContent = dirPart + basename(dir);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          pathInput.value = item.textContent!;
          hideDropdown();
          autoFillName(pathInput.value);
        });
        dropdown.appendChild(item);
      }
      dropdown.classList.add('visible');
    };

    pathInput.addEventListener('input', async () => {
      const value = pathInput.value;
      autoFillName(value);
      const lastSlash = lastSeparatorIndex(value);
      if (lastSlash === -1) { hideDropdown(); return; }

      const dirPart = value.substring(0, lastSlash + 1);
      const namePart = value.substring(lastSlash + 1).toLowerCase();

      const dirs = await window.vibeyard.fs.listDirs(dirPart, namePart || undefined);
      showSuggestions(dirs, dirPart);
    });

    pathInput.addEventListener('keydown', (e) => {
      const items = dropdown.querySelectorAll<HTMLElement>('.path-autocomplete-item');
      if (!items.length) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[activeIndex]?.classList.remove('active');
        activeIndex = Math.min(activeIndex + 1, items.length - 1);
        items[activeIndex].classList.add('active');
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[activeIndex]?.classList.remove('active');
        activeIndex = Math.max(activeIndex - 1, 0);
        items[activeIndex].classList.add('active');
        items[activeIndex].scrollIntoView({ block: 'nearest' });
      } else if ((e.key === 'Enter' || e.key === 'Tab') && activeIndex >= 0) {
        e.preventDefault();
        e.stopPropagation();
        pathInput.value = items[activeIndex].textContent!;
        hideDropdown();
        autoFillName(pathInput.value);
      } else if (e.key === 'Escape') {
        hideDropdown();
      }
    });

    pathInput.addEventListener('blur', () => {
      setTimeout(hideDropdown, 100);
      autoFillName(pathInput.value);
    });
  }
}

function initResizeHandle(): void {
  let dragging = false;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    resizeHandle.classList.add('active');
    document.body.classList.add('sidebar-resizing');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    // If the mouse was released outside the window, mouseup never fired — detect via buttons and tear down.
    if (!e.buttons) {
      dragging = false;
      resizeHandle.classList.remove('active');
      document.body.classList.remove('sidebar-resizing');
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      appState.setSidebarWidth(parseInt(sidebarEl.style.width, 10));
      return;
    }
    const width = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, e.clientX));
    sidebarEl.style.width = width + 'px';
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    resizeHandle.classList.remove('active');
    document.body.classList.remove('sidebar-resizing');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    appState.setSidebarWidth(parseInt(sidebarEl.style.width, 10));
  });
}

function applyCostFooterVisibility(): void {
  const visible = appState.preferences.sidebarViews?.costFooter ?? true;
  if (!visible) {
    sidebarFooterEl.classList.add('hidden');
  } else {
    renderCostFooter();
  }
}

function applyDiscussionsVisibility(): void {
  const visible = appState.preferences.sidebarViews?.discussions ?? true;
  sidebarDiscussionsEl.classList.toggle('hidden', !visible);
}

function renderCostFooter(): void {
  const costVisible = appState.preferences.sidebarViews?.costFooter ?? true;
  if (!costVisible) {
    sidebarFooterEl.classList.add('hidden');
    return;
  }
  const agg = getAggregateCost();
  if (agg.totalCostUsd > 0) {
    sidebarFooterEl.innerHTML =
      `<span class="footer-label">Total spend</span>` +
      `<span class="footer-value">$${agg.totalCostUsd.toFixed(4)}</span>`;
    sidebarFooterEl.classList.remove('hidden');
  } else {
    sidebarFooterEl.classList.add('hidden');
  }
}

function confirmRemoveProject(project: ProjectRecord): void {
  const historyCount = project.sessionHistory?.length ?? 0;
  const taskCount = project.board?.tasks?.length ?? 0;

  const parts: string[] = [];
  if (historyCount > 0) {
    parts.push(
      `all sessions and history (${historyCount} ${historyCount === 1 ? 'entry' : 'entries'})`,
    );
  }
  if (taskCount > 0) {
    parts.push(`kanban tasks (${taskCount} ${taskCount === 1 ? 'task' : 'tasks'})`);
  }

  const message = parts.length > 0
    ? `Remove project "${project.name}"? This will delete ${parts.join(' and ')} from Vibeyard. No files on disk will be affected.`
    : `Remove project "${project.name}"? No files on disk will be affected.`;
  showConfirmDialog('Remove project', message, {
    confirmLabel: 'Remove',
    onConfirm: () => appState.removeProject(project.id),
  });
}

function startProjectRename(project: ProjectRecord): void {
  const el = projectListEl.querySelector(
    `.project-item[data-project-id="${project.id}"]`,
  ) as HTMLElement | null;
  const nameEl = el?.querySelector('.project-name') as HTMLElement | null;
  if (!nameEl || nameEl.querySelector('input')) return;

  const input = document.createElement('input');
  input.maxLength = MAX_PROJECT_NAME_LENGTH;
  input.value = project.name;
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();
  renamingProjectId = project.id;

  let committed = false;
  const finish = (newName: string | null) => {
    if (committed) return;
    committed = true;
    input.remove();
    renamingProjectId = null;
    if (newName && newName !== project.name) {
      appState.renameProject(project.id, newName);
    } else {
      render();
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(input.value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(null);
    }
  });

  input.addEventListener('blur', () => finish(input.value.trim()));
  input.addEventListener('click', (e) => e.stopPropagation());
}

function showProjectContextMenu(x: number, y: number, project: ProjectRecord): void {
  hideProjectContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const renameItem = document.createElement('div');
  renameItem.className = 'tab-context-menu-item';
  renameItem.textContent = 'Rename';
  renameItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideProjectContextMenu();
    startProjectRename(project);
  });

  const hasSessions = project.sessions.length > 0;

  const closeAllItem = document.createElement('div');
  closeAllItem.className = 'tab-context-menu-item' + (!hasSessions ? ' disabled' : '');
  closeAllItem.textContent = 'Close All Sessions';
  if (hasSessions) {
    closeAllItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideProjectContextMenu();
      appState.removeAllSessions(project.id);
    });
  }

  const separator = document.createElement('div');
  separator.className = 'tab-context-menu-separator';

  const removeItem = document.createElement('div');
  removeItem.className = 'tab-context-menu-item';
  removeItem.textContent = 'Remove Project';
  removeItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideProjectContextMenu();
    confirmRemoveProject(project);
  });

  menu.appendChild(renameItem);
  menu.appendChild(closeAllItem);
  menu.appendChild(separator);
  menu.appendChild(removeItem);
  document.body.appendChild(menu);
  activeProjectContextMenu = menu;

  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;
}

function hideProjectContextMenu(): void {
  if (activeProjectContextMenu) {
    activeProjectContextMenu.remove();
    activeProjectContextMenu = null;
  }
}

let lastDiscussionsCount = -1;

function renderDiscussions(): void {
  const count = getDiscussionsNewCount();
  if (count === lastDiscussionsCount) return;
  lastDiscussionsCount = count;
  // Two unread indicators: dot is shown only when sidebar is collapsed (icon visible),
  // inline badge is shown only when expanded (text visible). CSS picks one per mode.
  const dot = count > 0 ? '<span class="discussions-icon-dot"></span>' : '';
  const inlineBadge = count > 0 ? ` <span class="discussions-badge">${count}</span>` : '';
  sidebarDiscussionsEl.title = 'Vibeyard Discussions';
  sidebarDiscussionsEl.innerHTML =
    `<span class="action-icon" aria-hidden="true">${ICON_DISCUSSIONS}${dot}</span>` +
    `<div class="discussions-text">` +
      `<div class="discussions-title">Vibeyard Discussions${inlineBadge}</div>` +
      `<div class="discussions-desc">Join the conversation about coding with AI</div>` +
    `</div>`;
}

