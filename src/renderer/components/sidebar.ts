import { appState, ProjectRecord } from '../state.js';
import { showModal, setModalError, closeModal, showConfirmDialog } from './modal.js';
import { showPreferencesModal } from './preferences-modal.js';
import { onChange as onCostChange, getAggregateCost } from '../session-cost.js';
import { hasUnreadInProject, onChange as onUnreadChange } from '../session-unread.js';
import { init as initDiscussionsBadge, getNewCount as getDiscussionsNewCount, markSeen as markDiscussionsSeen, onChange as onDiscussionsChange, DISCUSSIONS_URL } from '../discussions-badge.js';
import { basename, lastSeparatorIndex } from '../../shared/platform.js';
import { esc } from '../dom-utils.js';
import { renderFileTree, clearProjectState as clearFileTreeState, closeFileTree } from './file-tree.js';
import {
  renderSessionHistory,
  closeSessionHistory,
  clearProjectState as clearSessionHistoryState,
} from './session-history.js';

type ProjectPanel = 'history' | 'files' | null;
const projectPanelOpen = new Map<string, ProjectPanel>();

const projectListEl = document.getElementById('project-list')!;
let activeProjectContextMenu: HTMLElement | null = null;
const btnAddProject = document.getElementById('btn-add-project')!;
const btnPreferences = document.getElementById('btn-preferences')!;
const sidebarEl = document.getElementById('sidebar')!;
const resizeHandle = document.getElementById('sidebar-resize-handle')!;

const sidebarFooterEl = document.getElementById('sidebar-footer')!;
const sidebarDiscussionsEl = document.getElementById('sidebar-discussions')!;
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar')!;

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 500;

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
  appState.on('layout-changed', updateSubItems);


  onCostChange(() => {
    renderCostFooter();
  });

  onUnreadChange(render);
  appState.on('preferences-changed', () => {
    applyCostFooterVisibility();
    applyDiscussionsVisibility();
    render();
  });

  document.addEventListener('click', hideProjectContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideProjectContextMenu(); });

  render();
}

function makeSubItem(label: string, isActive: boolean, onClick: () => void): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'project-sub-item' + (isActive ? ' active' : '');
  el.textContent = label;
  el.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return el;
}

function updateSubItems(): void {
  const subItems = projectListEl.querySelector('.project-sub-items');
  if (!subItems) return;
  const project = appState.activeProject;
  if (!project) return;
  const isBoardMode = project.layout.mode === 'board';
  subItems.innerHTML = '';
  subItems.appendChild(makeSubItem('Board', isBoardMode, () => { if (!isBoardMode) appState.toggleBoard(); }));
  subItems.appendChild(makeSubItem('Sessions', !isBoardMode, () => { if (isBoardMode) appState.toggleBoard(); }));
}

function render(): void {
  hideProjectContextMenu();
  projectListEl.innerHTML = '';

  const fileTreeEnabled = appState.preferences.sidebarViews?.fileTree ?? true;
  const historyEnabled =
    (appState.preferences.sidebarViews?.sessionHistory ?? true) &&
    appState.preferences.sessionHistoryEnabled;

  for (const project of appState.projects) {
    const isActive = project.id === appState.activeProjectId;

    const wrapper = document.createElement('div');
    wrapper.className = 'project-row';

    const el = document.createElement('div');
    el.className = 'project-item' + (isActive ? ' active' : '');
    el.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="project-name${hasUnreadInProject(project.id) ? ' unread' : ''}">${esc(project.name)}${project.sessions.length ? ` <span class="project-session-count">(${project.sessions.length})</span>` : ''}</div>
        <div class="project-path">${esc(project.path)}</div>
      </div>
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

    wrapper.appendChild(el);

    if (isActive) {
      const isBoardMode = project.layout.mode === 'board';
      const subItems = document.createElement('div');
      subItems.className = 'project-sub-items';
      subItems.appendChild(makeSubItem('Board', isBoardMode, () => { if (!isBoardMode) appState.toggleBoard(); }));
      subItems.appendChild(makeSubItem('Sessions', !isBoardMode, () => { if (isBoardMode) appState.toggleBoard(); }));
      wrapper.appendChild(subItems);

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

    projectListEl.appendChild(wrapper);
  }
}

function buildProjectActions(
  project: ProjectRecord,
  openPanel: ProjectPanel,
  opts: { fileTreeEnabled: boolean; historyEnabled: boolean },
): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'project-actions';

  if (opts.historyEnabled) {
    const historyBtn = makeActionButton('Sessions', openPanel === 'history');
    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setProjectPanel(project.id, openPanel === 'history' ? null : 'history');
    });
    actions.appendChild(historyBtn);
  }

  if (opts.fileTreeEnabled) {
    const filesBtn = makeActionButton('Files', openPanel === 'files');
    filesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setProjectPanel(project.id, openPanel === 'files' ? null : 'files');
    });
    actions.appendChild(filesBtn);
  }

  const overviewBtn = makeActionButton('Overview', false);
  overviewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.openProjectTab(project.id);
  });
  actions.appendChild(overviewBtn);

  return actions;
}

function makeActionButton(label: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'project-action-btn' + (active ? ' active' : '');
  btn.textContent = label;
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
      nameInput.value = basename(path);
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
    sidebarFooterEl.textContent = `Total: $${agg.totalCostUsd.toFixed(4)}`;
    sidebarFooterEl.classList.remove('hidden');
  } else {
    sidebarFooterEl.classList.add('hidden');
  }
}

function confirmRemoveProject(project: ProjectRecord): void {
  const historyCount = project.sessionHistory?.length ?? 0;
  const message = historyCount > 0
    ? `Remove project "${project.name}"? This will delete all sessions and history (${historyCount} entries) from Vibeyard. No files on disk will be affected.`
    : `Remove project "${project.name}"? No files on disk will be affected.`;
  showConfirmDialog('Remove project', message, {
    confirmLabel: 'Remove',
    onConfirm: () => appState.removeProject(project.id),
  });
}

function showProjectContextMenu(x: number, y: number, project: ProjectRecord): void {
  hideProjectContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

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

function renderDiscussions(): void {
  const count = getDiscussionsNewCount();
  const badge = count > 0 ? ` <span class="discussions-badge">${count}</span>` : '';
  sidebarDiscussionsEl.innerHTML =
    `<div class="discussions-title">Vibeyard Discussions${badge}</div>` +
    '<div class="discussions-desc">Join the conversation about coding with AI</div>';
}

