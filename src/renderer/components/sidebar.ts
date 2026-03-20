import { appState } from '../state.js';
import { showModal, setModalError, closeModal } from './modal.js';
import { showPreferencesModal } from './preferences-modal.js';
import { onChange as onCostChange, getAggregateCost } from '../session-cost.js';
import { hasUnreadInProject, onChange as onUnreadChange } from '../session-unread.js';

const projectListEl = document.getElementById('project-list')!;
const btnAddProject = document.getElementById('btn-add-project')!;
const btnPreferences = document.getElementById('btn-preferences')!;
const sidebarEl = document.getElementById('sidebar')!;
const resizeHandle = document.getElementById('sidebar-resize-handle')!;

const sidebarFooterEl = document.getElementById('sidebar-footer')!;

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 500;

export function initSidebar(): void {
  btnAddProject.addEventListener('click', promptNewProject);
  btnPreferences.addEventListener('click', showPreferencesModal);
  initResizeHandle();
  appState.on('state-loaded', () => {
    if (appState.sidebarWidth) {
      sidebarEl.style.width = appState.sidebarWidth + 'px';
    }
    render();
  });
  appState.on('project-added', render);
  appState.on('project-removed', render);
  appState.on('project-changed', render);
  appState.on('session-added', render);
  appState.on('session-removed', render);

  onCostChange(() => {
    renderCostFooter();
  });

  onUnreadChange(render);

  render();
}

function render(): void {
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
      appState.setActiveProject(project.id);
    });

    el.querySelector('.project-delete')!.addEventListener('click', () => {
      appState.removeProject(project.id);
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
        const dir = await window.claudeIde.fs.browseDirectory();
        if (!dir) return;
        input.value = dir;
        const nameInput = document.getElementById('modal-project-name') as HTMLInputElement | null;
        if (nameInput && !nameInput.value.trim()) {
          nameInput.value = dir.split('/').pop() || '';
        }
      },
    },
  ], async (values) => {
    const name = values['project-name']?.trim();
    const path = values['project-path']?.trim();
    if (!name || !path) return;

    const isDir = await window.claudeIde.fs.isDirectory(path);
    if (!isDir) {
      setModalError('project-path', 'Directory does not exist');
      return;
    }

    closeModal();
    appState.addProject(name, path);
  });
}

function initResizeHandle(): void {
  let dragging = false;

  resizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    resizeHandle.classList.add('active');
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
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    appState.setSidebarWidth(parseInt(sidebarEl.style.width, 10));
  });
}

function renderCostFooter(): void {
  const agg = getAggregateCost();
  if (agg.totalCostUsd > 0) {
    sidebarFooterEl.textContent = `Total: $${agg.totalCostUsd.toFixed(4)}`;
    sidebarFooterEl.classList.remove('hidden');
  } else {
    sidebarFooterEl.classList.add('hidden');
  }
}

function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}
