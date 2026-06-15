import type { TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { getTeamChatProviderMetas } from '../../provider-availability.js';
import { showContextMenu } from '../board/board-context-menu.js';
import { showConfirmModal } from '../modal.js';
import { showTeamMemberModal } from './member-modal.js';
import { showMemberSessionsModal } from './member-sessions-modal.js';
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

  actions.appendChild(buildChatControl(projectId, member));

  card.appendChild(actions);

  return card;
}

function buildChatControl(projectId: string, member: TeamMember): HTMLElement {
  const teamProviders = getTeamChatProviderMetas();

  const chatBtn = document.createElement('button');
  chatBtn.className = 'btn-primary team-card-btn-primary';
  chatBtn.textContent = t('team.card.chatButton');

  if (teamProviders.length === 0) {
    chatBtn.disabled = true;
    chatBtn.title = t('team.card.chatUnsupportedTooltip');
    return chatBtn;
  }

  chatBtn.addEventListener('click', () => {
    appState.startTeamChat(projectId, member);
  });

  if (teamProviders.length === 1) return chatBtn;

  chatBtn.classList.add('team-card-chat-main');

  const chevronBtn = document.createElement('button');
  chevronBtn.className = 'btn-primary team-card-chat-dropdown';
  chevronBtn.setAttribute('aria-label', t('team.card.chatProviderAriaLabel'));
  chevronBtn.setAttribute('aria-haspopup', 'menu');
  chevronBtn.textContent = t('team.card.chatChevronGlyph');
  chevronBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const r = chevronBtn.getBoundingClientRect();
    showContextMenu(
      r.right,
      r.bottom + 4,
      teamProviders.map((p) => ({
        label: p.displayName,
        action: () => {
          appState.startTeamChat(projectId, member, p.id);
        },
      })),
    );
  });

  const group = document.createElement('div');
  group.className = 'team-card-chat-group';
  group.appendChild(chatBtn);
  group.appendChild(chevronBtn);
  return group;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '?';
}
