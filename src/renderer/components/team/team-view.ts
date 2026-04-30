import { appState } from '../../state.js';
import { instances } from './instance.js';
import { createMemberCard } from './member-card.js';
import { showTeamMemberModal } from './member-modal.js';
import { showPredefinedPicker } from './predefined-picker.js';

let teamEl: HTMLElement | null = null;

function isTeamActive(): boolean {
  const project = appState.activeProject;
  if (!project) return false;
  const active = project.sessions.find((s) => s.id === project.activeSessionId);
  return active?.type === 'team';
}

export function initTeamView(): void {
  appState.on('team-changed', () => {
    if (isTeamActive()) renderTeam();
  });
  appState.on('project-changed', () => {
    if (isTeamActive()) renderTeam();
  });
}

function buildTeamShell(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'team-view';

  const header = document.createElement('div');
  header.className = 'team-header';

  const title = document.createElement('span');
  title.className = 'team-title';
  title.textContent = 'Team';

  const actions = document.createElement('div');
  actions.className = 'team-header-actions';

  const browseBtn = document.createElement('button');
  browseBtn.className = 'team-header-btn';
  browseBtn.textContent = 'Browse';
  browseBtn.addEventListener('click', () => { void showPredefinedPicker(); });

  const addBtn = document.createElement('button');
  addBtn.className = 'team-header-btn team-header-btn-primary';
  addBtn.textContent = '+ New member';
  addBtn.addEventListener('click', () => showTeamMemberModal('create'));

  actions.appendChild(browseBtn);
  actions.appendChild(addBtn);

  header.appendChild(title);
  header.appendChild(actions);

  const grid = document.createElement('div');
  grid.className = 'team-grid';

  el.appendChild(header);
  el.appendChild(grid);
  return el;
}

export function renderTeam(target?: HTMLElement): void {
  const container = target ?? activeTeamContainer();
  if (!container) return;

  if (!teamEl) {
    teamEl = buildTeamShell();
  }

  if (!container.contains(teamEl)) {
    container.appendChild(teamEl);
  }
  teamEl.style.display = '';

  const grid = teamEl.querySelector('.team-grid') as HTMLElement;
  grid.innerHTML = '';

  const project = appState.activeProject;
  const projectId = project?.id;
  const members = appState.getTeamMembers();

  if (!projectId) {
    const empty = document.createElement('div');
    empty.className = 'team-empty';
    empty.textContent = 'Select a project to chat with team members.';
    grid.appendChild(empty);
    return;
  }

  if (members.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'team-empty';
    empty.innerHTML = 'No team members yet. Click <strong>+ New member</strong> to create one, or <strong>Browse</strong> to add a suggestion.';
    grid.appendChild(empty);
    return;
  }

  for (const member of members) {
    grid.appendChild(createMemberCard(member, projectId));
  }
}

export function hideTeamView(): void {
  if (teamEl) teamEl.style.display = 'none';
}

export function destroyTeamView(): void {
  if (teamEl) {
    teamEl.remove();
    teamEl = null;
  }
}

function activeTeamContainer(): HTMLElement | null {
  const project = appState.activeProject;
  if (!project) return null;
  const active = project.sessions.find((s) => s.id === project.activeSessionId);
  if (active?.type !== 'team') return null;
  const instance = instances.get(active.id);
  return instance?.element ?? null;
}
