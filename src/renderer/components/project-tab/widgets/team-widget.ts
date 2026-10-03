import type { TeamMember } from '../../../../shared/types.js';
import { appState } from '../../../state.js';
import { showMemberSessionsModal } from '../../team/member-sessions-modal.js';
import { buildTeamChatControl } from '../../team/chat-control.js';
import {
  loadProviderAvailability,
} from '../../../provider-availability.js';
import { createWidgetEmpty } from './widget-empty.js';
import type { WidgetFactory } from './widget-host.js';

export const createTeamWidget: WidgetFactory = (host) => {
  const root = document.createElement('div');
  root.className = 'widget-team';

  const toolbar = document.createElement('div');
  toolbar.className = 'widget-team-toolbar';

  const countLabel = document.createElement('span');
  countLabel.className = 'widget-team-count';
  toolbar.appendChild(countLabel);

  const openTabBtn = document.createElement('button');
  openTabBtn.className = 'widget-team-add-btn';
  openTabBtn.textContent = 'Open Team tab';
  openTabBtn.title = 'Open the full Team tab';
  openTabBtn.addEventListener('click', () => {
    appState.openTeamTab(host.projectId);
  });
  toolbar.appendChild(openTabBtn);

  root.appendChild(toolbar);

  const grid = document.createElement('div');
  grid.className = 'widget-team-grid';
  root.appendChild(grid);

  function render(): void {
    const members = appState.team.members;
    countLabel.textContent = members.length === 1 ? '1 member' : `${members.length} members`;

    grid.innerHTML = '';

    if (members.length === 0) {
      grid.appendChild(createWidgetEmpty(
        'No team members yet.',
        'Open Team tab',
        () => appState.openTeamTab(host.projectId),
      ));
      return;
    }

    for (const member of members) {
      grid.appendChild(buildCard(member, host.projectId));
    }
  }

  const offTeam = appState.on('team-changed', () => render());
  // A member's Chat shape (chevron hidden when pinned) and the pin itself depend
  // on profiles, so a profile delete/rename must re-render too.
  const offProfiles = appState.on('profiles-changed', () => render());

  render();

  let destroyed = false;
  // Provider availability loads asynchronously at app start; re-render once
  // it's ready so Chat buttons enable and the multi-provider chevron appears.
  void loadProviderAvailability().then(() => {
    if (!destroyed) render();
  });

  return {
    element: root,
    destroy() {
      destroyed = true;
      offTeam();
      offProfiles();
    },
    refresh() {
      render();
    },
  };
};

function buildCard(member: TeamMember, projectId: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'widget-team-card';

  const header = document.createElement('div');
  header.className = 'widget-team-card-header';

  const avatar = document.createElement('div');
  avatar.className = 'widget-team-card-avatar';
  avatar.textContent = initials(member.name);
  header.appendChild(avatar);

  const heading = document.createElement('div');
  heading.className = 'widget-team-card-heading';

  const nameEl = document.createElement('div');
  nameEl.className = 'widget-team-card-name';
  nameEl.textContent = member.name;
  heading.appendChild(nameEl);

  const roleEl = document.createElement('div');
  roleEl.className = 'widget-team-card-role';
  roleEl.textContent = member.role;
  heading.appendChild(roleEl);

  header.appendChild(heading);
  card.appendChild(header);

  if (member.description) {
    const desc = document.createElement('div');
    desc.className = 'widget-team-card-description';
    desc.textContent = member.description;
    card.appendChild(desc);
  }

  const actions = document.createElement('div');
  actions.className = 'widget-team-card-actions';

  actions.appendChild(buildTeamChatControl(projectId, member, {
    chat: 'btn-primary btn-sm',
    chatMain: 'widget-team-card-chat-main',
    chevron: 'btn-primary btn-sm widget-team-card-chat-dropdown',
    group: 'widget-team-card-chat-group',
  }));

  const sessionsBtn = document.createElement('button');
  sessionsBtn.className = 'btn-secondary btn-sm widget-team-card-btn';
  sessionsBtn.textContent = 'Sessions';
  sessionsBtn.addEventListener('click', () => showMemberSessionsModal(member, projectId));
  actions.appendChild(sessionsBtn);

  card.appendChild(actions);

  return card;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
}
