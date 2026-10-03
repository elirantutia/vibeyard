import type { ProviderId, TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { getProviderCapabilities, getProviderDisplayName, getTeamCapableProviderIds, loadProviderAvailability } from '../../provider-availability.js';
import { showModal, closeModal, setModalError, type FieldDef } from '../modal.js';
import { t } from '../../i18n.js';

export async function showTeamMemberModal(mode: 'create' | 'edit', existing?: TeamMember): Promise<void> {
  const fields: FieldDef[] = [
    { label: t('team.memberModal.nameLabel'), id: 'name', placeholder: t('team.memberModal.namePlaceholder'), defaultValue: existing?.name ?? '' },
    { label: t('team.memberModal.roleLabel'), id: 'role', placeholder: t('team.memberModal.rolePlaceholder'), defaultValue: existing?.role ?? '' },
    { label: t('team.memberModal.descriptionLabel'), id: 'description', placeholder: t('team.memberModal.descriptionPlaceholder'), defaultValue: existing?.description ?? '' },
    {
      label: t('team.memberModal.systemPromptLabel'),
      id: 'systemPrompt',
      type: 'textarea',
      placeholder: t('team.memberModal.systemPromptPlaceholder'),
      defaultValue: existing?.systemPrompt ?? '',
      rows: 16,
    },
    {
      label: t('team.memberModal.installAsAgentLabel'),
      id: 'installAsAgent',
      type: 'checkbox',
      defaultValue: (existing ? existing.installAsAgent : true) ? 'true' : 'false',
    },
  ];

  // Backend pin: a Profile carries the provider (CLI) + config dir this member's
  // Chat sessions run on. Only offered when profiles exist; "Default" leaves the
  // member unpinned so the project → global fallback chain applies. A pin only
  // takes effect when the profile's provider is team-capable, so profiles that
  // can't run team personas are disabled and annotated rather than silently
  // saved as an inert pin (mirrors the new-session dialog's provider options).
  // If the availability check fails, the modal still opens with every option
  // enabled — a pin to a non-capable provider just falls back at runtime.
  // Only profile-capable providers (capabilities.profiles) are offered, like
  // the rest of the UI; if provider metas are unavailable, show all profiles.
  const profiles = appState.profiles.filter((p) => {
    const caps = getProviderCapabilities(p.providerId);
    return caps ? caps.profiles === true : true;
  });
  if (profiles.length > 0) {
    let teamCapable: Set<ProviderId> | null = null;
    try {
      await loadProviderAvailability();
      teamCapable = getTeamCapableProviderIds();
    } catch (err) {
      console.warn('provider availability check failed; showing all backend options:', err);
    }
    const pinnedStillExists = !!existing?.profileId && profiles.some((p) => p.id === existing.profileId);
    fields.push({
      label: t('team.memberModal.backendLabel'),
      id: 'backend',
      type: 'select',
      defaultValue: pinnedStillExists ? existing!.profileId! : '',
      options: [
        { value: '', label: t('team.memberModal.backendDefaultOption') },
        ...profiles.map((p) => {
          const capable = !teamCapable || teamCapable.has(p.providerId);
          return {
            value: p.id,
            label: capable
              ? `${p.name} · ${getProviderDisplayName(p.providerId)}`
              : t('team.memberModal.backendNotTeamCapable', { name: p.name, provider: getProviderDisplayName(p.providerId) }),
            disabled: !capable,
          };
        }),
      ],
    });
  }

  const title = mode === 'create' ? t('team.memberModal.titleCreate') : t('team.memberModal.titleEdit');
  const confirmLabel = mode === 'create' ? t('team.memberModal.confirmCreate') : t('team.memberModal.confirmEdit');

  showModal(title, fields, (values) => {
    const name = values.name?.trim() ?? '';
    const role = values.role?.trim() ?? '';
    const systemPrompt = values.systemPrompt?.trim() ?? '';

    if (!name) { setModalError('name', t('team.memberModal.nameRequired')); return; }
    if (!role) { setModalError('role', t('team.memberModal.roleRequired')); return; }
    if (!systemPrompt) { setModalError('systemPrompt', t('team.memberModal.systemPromptRequired')); return; }

    const description = values.description?.trim() || undefined;
    const installAsAgent = values.installAsAgent === 'true';
    const profileId = values.backend || undefined;

    if (mode === 'create') {
      appState.addTeamMember({
        name,
        role,
        description,
        systemPrompt,
        source: 'custom',
        installAsAgent,
        profileId,
      });
    } else if (existing) {
      appState.updateTeamMember(existing.id, { name, role, description, systemPrompt, installAsAgent, profileId });
    }

    closeModal();
  }, { confirmLabel });
}
