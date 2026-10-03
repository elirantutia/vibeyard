import type { TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { showConfirmModal } from '../modal.js';
import { showTeamMemberModal } from './member-modal.js';
import { showMemberSessionsModal } from './member-sessions-modal.js';
import { buildTeamChatControl } from './chat-control.js';
import { resolvePinnedTeamProfile } from '../../state/team-state.js';
import { t } from '../../i18n.js';

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

  // Backend badge: a pinned member shows which Profile (and thus provider) its
  // Chat sessions actually run on. Uses the same team-capability check as the
  // Chat control, so the badge disappears exactly when the pin stops being
  // effective (provider uninstalled) rather than claiming a backend that won't be used.
  const pinnedProfile = resolvePinnedTeamProfile(member, appState.profiles);
  if (pinnedProfile) {
    const badge = document.createElement('span');
    badge.className = 'team-card-backend-badge';
    badge.textContent = pinnedProfile.name;
    badge.title = t('team.card.backendBadgeTooltip', { profile: pinnedProfile.name });
    header.appendChild(badge);
  }

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
  sessionsBtn.className = 'btn-secondary team-card-btn';
  sessionsBtn.textContent = t('team.card.sessionsButton');
  sessionsBtn.addEventListener('click', () => showMemberSessionsModal(member, projectId));
  actions.appendChild(sessionsBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-secondary team-card-btn';
  editBtn.textContent = t('team.card.editButton');
  editBtn.addEventListener('click', () => showTeamMemberModal('edit', member));
  actions.appendChild(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-secondary danger team-card-btn';
  deleteBtn.textContent = t('team.card.deleteButton');
  deleteBtn.addEventListener('click', () => {
    showConfirmModal(
      t('team.card.deleteTitle'),
      t('team.card.deleteMessage', { name: member.name }),
      () => appState.removeTeamMember(member.id),
      { confirmLabel: t('team.card.deleteConfirm') },
    );
  });
  actions.appendChild(deleteBtn);

  actions.appendChild(buildTeamChatControl(projectId, member, {
    chat: 'btn-primary team-card-btn-primary',
    chatMain: 'team-card-chat-main',
    chevron: 'btn-primary team-card-chat-dropdown',
    group: 'team-card-chat-group',
  }));

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
