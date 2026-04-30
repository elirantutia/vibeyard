import type { TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { showConfirmModal } from '../modal.js';
import { showTeamMemberModal } from './member-modal.js';
import { showMemberSessionsModal } from './member-sessions-modal.js';

export function createMemberCard(member: TeamMember, projectId: string): HTMLElement {
  const card = document.createElement('div');
  card.className = 'team-card';
  card.dataset['memberId'] = member.id;

  const header = document.createElement('div');
  header.className = 'team-card-header';

  const avatar = document.createElement('div');
  avatar.className = 'team-card-avatar';
  avatar.textContent = initials(member.name);

  const heading = document.createElement('div');
  heading.className = 'team-card-heading';

  const nameEl = document.createElement('div');
  nameEl.className = 'team-card-name';
  nameEl.textContent = member.name;

  const roleEl = document.createElement('div');
  roleEl.className = 'team-card-role';
  roleEl.textContent = member.role;

  heading.appendChild(nameEl);
  heading.appendChild(roleEl);

  header.appendChild(avatar);
  header.appendChild(heading);

  const sourceBadge = document.createElement('span');
  sourceBadge.className = `team-card-badge team-card-badge-${member.source}`;
  sourceBadge.textContent = member.source === 'predefined' ? 'Predefined' : 'Custom';
  header.appendChild(sourceBadge);

  card.appendChild(header);

  if (member.description) {
    const desc = document.createElement('div');
    desc.className = 'team-card-description';
    desc.textContent = member.description;
    card.appendChild(desc);
  }

  const actions = document.createElement('div');
  actions.className = 'team-card-actions';

  const sessionsBtn = document.createElement('button');
  sessionsBtn.className = 'team-card-btn';
  sessionsBtn.textContent = 'Sessions';
  sessionsBtn.addEventListener('click', () => showMemberSessionsModal(member, projectId));
  actions.appendChild(sessionsBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'team-card-btn';
  editBtn.textContent = 'Edit';
  editBtn.addEventListener('click', () => showTeamMemberModal('edit', member));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'team-card-btn team-card-btn-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', () => {
    showConfirmModal(
      'Delete team member',
      `Remove "${member.name}" from your team? This does not affect any chat sessions you've already started.`,
      () => appState.removeTeamMember(member.id),
      { confirmLabel: 'Delete' },
    );
  });
  actions.appendChild(deleteBtn);

  const chatBtn = document.createElement('button');
  chatBtn.className = 'team-card-btn team-card-btn-primary';
  chatBtn.textContent = 'Chat';
  chatBtn.addEventListener('click', () => {
    appState.startTeamChat(projectId, member);
  });
  actions.appendChild(chatBtn);

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
