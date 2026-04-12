import { appState, ProjectRecord } from '../state.js';
import { showModal, setModalError, closeModal } from './modal.js';
import { showPreferencesModal } from './preferences-modal.js';
import { onChange as onCostChange, getAggregateCost } from '../session-cost.js';
import { hasUnreadInProject, onChange as onUnreadChange } from '../session-unread.js';
import { basename, lastSeparatorIndex } from '../../shared/platform.js';

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

  sidebarDiscussionsEl.innerHTML =
    '<div class="discussions-title">Vibeyard Discussions</div>' +
    '<div class="discussions-desc">Join the conversation about coding with AI</div>';
  sidebarDiscussionsEl.addEventListener('click', () => {
    window.vibeyard.app.openExternal('https://github.com/elirantutia/vibeyard/discussions');
  });

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
  appState.on('project-removed', render);
  appState.on('project-changed', render);
  appState.on('session-added', render);
  appState.on('session-removed', render);


  onCostChange(() => {
    renderCostFooter();
  });

  onUnreadChange(render);
  appState.on('preferences-changed', () => applyCostFooterVisibility());

  document.addEventListener('click', hideProjectContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideProjectContextMenu(); });

  render();
}

function render(): void {
  hideProjectContextMenu();
  projectListEl.innerHTML = '';

  for (const project of appState.projects) {
    const el = document.createElement('div');
    el.className = 'project-item' + (project.id === appState.activeProjectId ? ' active' : '');
    el.innerHTML = `
      <div style="flex:1;min-width:0">
        <div class="project-name${hasUnreadInProject(project.id) ? ' unread' : ''}">${esc(project.name)}${project.sessions.length ? ` <span class="project-session-count">(${project.sessions.length})</span>` : ''}</div>
        <div class="project-path">${esc(project.path)}</div>
      </div>
      <span class="project-delete" title="Remove project">&times;</span>
    `;

    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('project-delete')) return;
      if (project.id === appState.activeProjectId) {
        appState.toggleSidebar();
      } else {
        appState.setActiveProject(project.id);
      }
    });

    el.querySelector('.project-delete')!.addEventListener('click', () => {
      confirmRemoveProject(project);
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showProjectContextMenu(e.clientX, e.clientY, project);
    });

    projectListEl.appendChild(el);
  }
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
  if (!confirm(message)) return;
  appState.removeProject(project.id);
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

function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}
