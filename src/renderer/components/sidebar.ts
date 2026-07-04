import { appState, MAX_PROJECT_NAME_LENGTH, ProjectRecord } from '../state.js';
import { showModal, setModalError, closeModal, showConfirmDialog, FieldDef } from './modal.js';
import { showPreferencesModal } from './preferences-modal.js';
import { hasUnreadInProject, onChange as onUnreadChange } from '../session-unread.js';
import { onChange as onActivityChange } from '../session-activity.js';
import { getProjectStatus, projectInitial } from '../project-status.js';
import { init as initDiscussionsBadge, getNewCount as getDiscussionsNewCount, markSeen as markDiscussionsSeen, onChange as onDiscussionsChange, DISCUSSIONS_URL } from '../discussions-badge.js';
import { basename, lastSeparatorIndex } from '../../shared/platform.js';
import { deriveProjectName } from '../../shared/project-name.js';
import { esc } from '../dom-utils.js';
import { renderFileTree, clearProjectState as clearFileTreeState, closeFileTree } from './file-tree.js';
import {
  renderSessionHistory,
  closeSessionHistory,
  clearProjectState as clearSessionHistoryState,
} from './session-history.js';
import { attachHoverCard } from './hover-card.js';
import { mountGitPanel, closeGitPanel } from './git-panel.js';
import { gitChangeCount, onChange as onGitStatusChange } from '../git-status.js';
import { ICON_KANBAN, ICON_TEAM, ICON_OVERVIEW, ICON_SESSIONS, ICON_FILES, ICON_GIT } from '../icons.js';
import { t } from '../i18n.js';

type ProjectPanel = 'history' | 'files' | 'git' | null;
const projectPanelOpen = new Map<string, ProjectPanel>();

const projectListEl = document.getElementById('project-list')!;
let activeProjectContextMenu: HTMLElement | null = null;
let renamingProjectId: string | null = null;
const btnAddProject = document.getElementById('btn-add-project')!;
const btnPreferences = document.getElementById('btn-preferences')!;
const sidebarEl = document.getElementById('sidebar')!;
const resizeHandle = document.getElementById('sidebar-resize-handle')!;

const sidebarDiscussionsEl = document.getElementById('sidebar-discussions')!;
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar')!;

const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 500;

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
  btnPreferences.addEventListener('click', () => showPreferencesModal());
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

  onUnreadChange(render);
  // Keep the active project's Git tab badge in sync. Surgical when the button is
  // already present; a full render only when repo-ness first becomes known (the
  // button needs to appear/disappear).
  onGitStatusChange((projectId) => {
    if (projectId !== appState.activeProjectId) return;
    const gitBtn = projectListEl.querySelector('.project-row.active .project-action-btn.git-toggle');
    const count = gitChangeCount(projectId);
    const gitEnabled = appState.preferences.sidebarViews?.gitPanel ?? true;
    if (!gitBtn) {
      if (count !== null && gitEnabled) render();
      return;
    }
    if (count === null || !gitEnabled) { render(); return; } // repo went away / disabled
    const badge = gitBtn.querySelector('.project-action-badge');
    if (badge) {
      badge.textContent = String(count);
      badge.classList.toggle('hidden', count === 0);
    }
  });
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
    applyDiscussionsVisibility();
    render();
  });
  // Adding/removing a profile or changing a default flips the badge's
  // visibility/label on the active card.
  appState.on('profiles-changed', render);

  document.addEventListener('click', hideProjectContextMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideProjectContextMenu(); });

  render();
}

interface RenderOpts {
  fileTreeEnabled: boolean;
  historyEnabled: boolean;
  gitEnabled: boolean;
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
    gitEnabled: appState.preferences.sidebarViews?.gitPanel ?? true,
  };

  // Projects keep their user-controlled order (drag-and-drop reorderable); the
  // active one is marked as a card in place rather than pinned to the top.
  for (const { project, isActive } of projectRenderOrder(appState.projects, appState.activeProjectId)) {
    projectListEl.appendChild(buildProjectRow(project, isActive, opts));
  }
}

/**
 * Render plan for the project list: every project in its stored
 * (user-reorderable) order, each flagged `isActive` when it is the current
 * project. The active project is marked **in place** — it is never pinned to
 * the top, so selecting a project does not reorder the list.
 */
export function projectRenderOrder(
  projects: ProjectRecord[],
  activeProjectId: string | null,
): Array<{ project: ProjectRecord; isActive: boolean }> {
  return projects.map((project) => ({ project, isActive: project.id === activeProjectId }));
}

/**
 * Label for the project's effective Claude profile, or `undefined` when no badge
 * should render. Shown only when more than one Claude profile exists (mirrors the
 * session status-line gate in terminal-pane.ts). Resolution matches `resolveProfile`:
 * `project.defaultProfileId ?? preferences.defaultProfileId`; a missing/unknown id
 * (base ~/.claude) is labeled "Default".
 */
export function projectProfileLabel(project: ProjectRecord): string | undefined {
  const providerProfiles = appState.profiles.filter((p) => p.providerId === 'claude');
  if (providerProfiles.length <= 1) return undefined;
  const id = project.defaultProfileId ?? appState.preferences.defaultProfileId;
  if (!id) return t('sidebar.default');
  return providerProfiles.find((p) => p.id === id)?.name ?? t('sidebar.default');
}

function buildProjectRow(project: ProjectRecord, isActive: boolean, opts: RenderOpts): HTMLElement {
  const { fileTreeEnabled, historyEnabled, gitEnabled } = opts;

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
  // Only the active card surfaces the profile badge, and only when multiple
  // Claude profiles exist (the session count is hidden on the active card, so
  // the badge takes that slot).
  const profileLabel = isActive ? projectProfileLabel(project) : undefined;
  const profileBadge = profileLabel
    ? `<span class="project-profile-badge" title="${esc(t('sidebar.claudeProfileTooltip'))}">${esc(profileLabel)}</span>`
    : '';
  el.innerHTML = `
    ${lead}
    <div class="project-main">
      <div class="project-name${hasUnreadInProject(project.id) ? ' unread' : ''}">${esc(project.name)}</div>
      <div class="project-path">${esc(project.path)}</div>
    </div>
    ${profileBadge}
    ${countPill}
    <span class="project-delete" title="${esc(t('sidebar.removeProjectTooltip'))}">&times;</span>
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
    // A 'git' panel only stays open while the git view is enabled in prefs.
    let openPanel = projectPanelOpen.get(project.id) ?? null;
    if (openPanel === 'git' && !gitEnabled) openPanel = null;
    const actions = buildProjectActions(project, openPanel, { fileTreeEnabled, historyEnabled, gitEnabled });
    wrapper.appendChild(actions);

    if (openPanel !== null) {
      const panelContainer = document.createElement('div');
      panelContainer.className = 'project-panel';
      if (openPanel === 'files') {
        panelContainer.classList.add('project-panel-files', 'project-file-tree');
        renderFileTree(project, panelContainer);
      } else if (openPanel === 'git') {
        panelContainer.classList.add('project-panel-git');
        mountGitPanel(project, panelContainer);
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
  opts: { fileTreeEnabled: boolean; historyEnabled: boolean; gitEnabled: boolean },
): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'project-actions';

  // Only the panel toggles (Files, Sessions) reflect a selected state, derived
  // from openPanel below. The tab buttons (Overview, Kanban, Team) never mark
  // themselves selected from the open tab — opening a tab leaves them inert.
  const overviewBtn = makeActionButton(t('sidebar.overview'), ICON_OVERVIEW, false);
  overviewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.openProjectTab(project.id);
  });
  actions.appendChild(overviewBtn);

  const kanbanBtn = makeActionButton(t('sidebar.kanban'), ICON_KANBAN, false);
  kanbanBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.openKanbanTab(project.id);
  });
  actions.appendChild(kanbanBtn);

  if (opts.historyEnabled) {
    const historyBtn = makeActionButton(t('sidebar.sessions'), ICON_SESSIONS, openPanel === 'history');
    historyBtn.classList.add('panel-toggle');
    historyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setProjectPanel(project.id, openPanel === 'history' ? null : 'history');
    });
    actions.appendChild(historyBtn);
  }

  const teamBtn = makeActionButton(t('sidebar.team'), ICON_TEAM, false);
  teamBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    appState.openTeamTab(project.id);
  });
  actions.appendChild(teamBtn);

  if (opts.fileTreeEnabled) {
    const filesBtn = makeActionButton(t('sidebar.files'), ICON_FILES, openPanel === 'files');
    filesBtn.classList.add('panel-toggle');
    filesBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setProjectPanel(project.id, openPanel === 'files' ? null : 'files');
    });
    actions.appendChild(filesBtn);
  }

  // Git changes — only for git repos. The badge surfaces the change count so the
  // tab still gives passive awareness without expanding (mirrors the old panel).
  const gitCount = gitChangeCount(project.id);
  if (opts.gitEnabled && gitCount !== null) {
    const gitBtn = makeActionButton(t('sidebar.git'), ICON_GIT, openPanel === 'git');
    gitBtn.classList.add('panel-toggle', 'git-toggle');
    const badge = document.createElement('span');
    badge.className = 'project-action-badge' + (gitCount === 0 ? ' hidden' : '');
    badge.textContent = String(gitCount);
    gitBtn.appendChild(badge);
    gitBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setProjectPanel(project.id, openPanel === 'git' ? null : 'git');
    });
    actions.appendChild(gitBtn);
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
  if (current === 'git' && next !== 'git') closeGitPanel();
  if (next === null) {
    projectPanelOpen.delete(projectId);
  } else {
    projectPanelOpen.set(projectId, next);
  }
  render();
}

/** Toggle the Git changes panel on the active project (Cmd/Ctrl+Shift+G). */
export function toggleGitPanel(): void {
  const project = appState.activeProject;
  if (!project) return;
  if (!(appState.preferences.sidebarViews?.gitPanel ?? true)) return;
  if (gitChangeCount(project.id) === null) return; // not a git repo
  const current = projectPanelOpen.get(project.id) ?? null;
  setProjectPanel(project.id, current === 'git' ? null : 'git');
}

export function promptNewProject(): void {
  const claudeProfiles = appState.profiles.filter((p) => p.providerId === 'claude');
  const fields: FieldDef[] = [
    { label: t('sidebar.newProject.nameLabel'), id: 'project-name', placeholder: t('sidebar.newProject.namePlaceholder') },
    {
      label: t('sidebar.newProject.pathLabel'), id: 'project-path', placeholder: t('sidebar.newProject.pathPlaceholder'),
      buttonLabel: t('sidebar.newProject.browseButton'),
      onButtonClick: async (input) => {
        const dir = await window.vibeyard.fs.browseDirectory();
        if (!dir) return;
        input.value = dir;
        autoFillName(dir);
      },
    },
  ];
  if (claudeProfiles.length > 0) {
    fields.push({
      label: t('sidebar.newProject.defaultProfileLabel'),
      id: 'profile',
      type: 'select',
      defaultValue: appState.preferences.defaultProfileId ?? '',
      options: [
        { value: '', label: t('sidebar.defaultProfileOption') },
        ...claudeProfiles.map((p) => ({ value: p.id, label: p.name })),
      ],
    });
  }
  showModal(t('sidebar.newProject.title'), fields, async (values) => {
    const name = values['project-name']?.trim();
    const rawPath = values['project-path']?.trim();
    if (!name || !rawPath) return;

    const projectPath = await window.vibeyard.fs.expandPath(rawPath);
    const isDir = await window.vibeyard.fs.isDirectory(projectPath);
    if (!isDir) {
      setModalError('project-path', t('sidebar.newProject.directoryNotExist'));
      return;
    }

    closeModal();
    appState.addProject(name, projectPath, values['profile'] || undefined);
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

function applyDiscussionsVisibility(): void {
  const visible = appState.preferences.sidebarViews?.discussions ?? true;
  sidebarDiscussionsEl.classList.toggle('hidden', !visible);
}

function confirmRemoveProject(project: ProjectRecord): void {
  const historyCount = project.sessionHistory?.length ?? 0;
  const taskCount = project.board?.tasks?.length ?? 0;

  const parts: string[] = [];
  if (historyCount > 0) {
    const noun = historyCount === 1
      ? t('sidebar.removeConfirm.sessionsHistoryNounSingular')
      : t('sidebar.removeConfirm.sessionsHistoryNounPlural');
    parts.push(t('sidebar.removeConfirm.sessionsHistory', { count: historyCount, noun }));
  }
  if (taskCount > 0) {
    const noun = taskCount === 1
      ? t('sidebar.removeConfirm.kanbanTasksNounSingular')
      : t('sidebar.removeConfirm.kanbanTasksNounPlural');
    parts.push(t('sidebar.removeConfirm.kanbanTasks', { count: taskCount, noun }));
  }

  const message = parts.length > 0
    ? t('sidebar.removeConfirm.withDataMessage', { name: project.name, parts: parts.join(' and ') })
    : t('sidebar.removeConfirm.emptyMessage', { name: project.name });
  showConfirmDialog(t('sidebar.removeConfirm.title'), message, {
    confirmLabel: t('sidebar.removeConfirm.confirmLabel'),
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
  renameItem.textContent = t('contextMenu.project.rename');
  renameItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideProjectContextMenu();
    startProjectRename(project);
  });

  const hasSessions = project.sessions.length > 0;

  const closeAllItem = document.createElement('div');
  closeAllItem.className = 'tab-context-menu-item' + (!hasSessions ? ' disabled' : '');
  closeAllItem.textContent = t('contextMenu.project.closeAllSessions');
  if (hasSessions) {
    closeAllItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideProjectContextMenu();
      appState.removeAllSessions(project.id);
    });
  }

  const separator = document.createElement('div');
  separator.className = 'tab-context-menu-separator';

  // Project Settings — currently just the default profile, shown only when
  // the user has Claude profiles to choose from.
  const claudeProfiles = appState.profiles.filter((p) => p.providerId === 'claude');
  let settingsItem: HTMLDivElement | null = null;
  if (claudeProfiles.length > 0) {
    settingsItem = document.createElement('div');
    settingsItem.className = 'tab-context-menu-item';
    settingsItem.textContent = t('contextMenu.project.settings');
    settingsItem.addEventListener('click', (e) => {
      e.stopPropagation();
      hideProjectContextMenu();
      promptProjectSettings(project);
    });
  }

  const removeItem = document.createElement('div');
  removeItem.className = 'tab-context-menu-item';
  removeItem.textContent = t('contextMenu.project.removeProject');
  removeItem.addEventListener('click', (e) => {
    e.stopPropagation();
    hideProjectContextMenu();
    confirmRemoveProject(project);
  });

  menu.appendChild(renameItem);
  menu.appendChild(closeAllItem);
  if (settingsItem) menu.appendChild(settingsItem);
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

/** Project-level settings dialog. Currently just the default Claude profile. */
function promptProjectSettings(project: ProjectRecord): void {
  const claudeProfiles = appState.profiles.filter((p) => p.providerId === 'claude');
  showModal(t('sidebar.projectSettings.title'), [
    {
      label: t('sidebar.projectSettings.defaultProfileLabel'),
      id: 'profile',
      type: 'select',
      defaultValue: project.defaultProfileId ?? '',
      options: [
        { value: '', label: t('sidebar.defaultProfileOption') },
        ...claudeProfiles.map((p) => ({ value: p.id, label: p.name })),
      ],
    },
  ], (values) => {
    appState.setProjectDefaultProfile(project.id, values['profile'] || undefined);
    closeModal();
  });
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
  sidebarDiscussionsEl.title = t('sidebar.discussions.tooltip');
  sidebarDiscussionsEl.innerHTML =
    `<span class="action-icon" aria-hidden="true">${ICON_DISCUSSIONS}${dot}</span>` +
    `<div class="discussions-text">` +
      `<div class="discussions-title">${esc(t('sidebar.discussions.title'))}${inlineBadge}</div>` +
      `<div class="discussions-desc">${esc(t('sidebar.discussions.description'))}</div>` +
    `</div>`;
}

