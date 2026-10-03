import type { TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { getTeamChatProviderMetas } from '../../provider-availability.js';
import { resolvePinnedTeamProfile } from '../../state/team-state.js';
import { showContextMenu } from '../board/board-context-menu.js';
import { t } from '../../i18n.js';

/** CSS class names for the Chat control's parts, so the card and the widget can share the logic. */
export interface TeamChatControlClasses {
  /** Base classes for the Chat button. */
  chat: string;
  /** Added to the Chat button when the provider chevron is shown (split-button shape). */
  chatMain: string;
  /** Classes for the chevron button. */
  chevron: string;
  /** Classes for the wrapper that holds Chat + chevron. */
  group: string;
}

/**
 * Build the Chat control for a team member. Shared by the Team tab card and the
 * Overview team widget so the pin rule stays in one place: a member pinned to a
 * team-capable Profile launches directly on that backend with the provider
 * chevron hidden; an unpinned member keeps the chevron to pick a provider.
 */
export function buildTeamChatControl(
  projectId: string,
  member: TeamMember,
  classes: TeamChatControlClasses,
): HTMLElement {
  const teamProviders = getTeamChatProviderMetas();

  const chatBtn = document.createElement('button');
  chatBtn.className = classes.chat;
  chatBtn.textContent = t('team.card.chatButton');

  if (teamProviders.length === 0) {
    chatBtn.disabled = true;
    chatBtn.title = t('team.card.chatUnsupportedTooltip');
    return chatBtn;
  }

  chatBtn.addEventListener('click', () => {
    appState.startTeamChat(projectId, member);
  });

  // A pinned member's backend is fully determined by its Profile, so the
  // provider chevron is hidden. A dangling or non-team-capable pin leaves it.
  const pinned = resolvePinnedTeamProfile(member, appState.profiles);
  if (pinned || teamProviders.length === 1) return chatBtn;

  chatBtn.classList.add(classes.chatMain);

  const chevronBtn = document.createElement('button');
  chevronBtn.className = classes.chevron;
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
  group.className = classes.group;
  group.appendChild(chatBtn);
  group.appendChild(chevronBtn);
  return group;
}
