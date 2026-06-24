import type { TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { showModal, closeModal, setModalError, type FieldDef } from '../modal.js';
import { t } from '../../i18n.js';

export function showTeamMemberModal(mode: 'create' | 'edit', existing?: TeamMember): void {
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

    if (mode === 'create') {
      appState.addTeamMember({
        name,
        role,
        description,
        systemPrompt,
        source: 'custom',
        installAsAgent,
      });
    } else if (existing) {
      appState.updateTeamMember(existing.id, { name, role, description, systemPrompt, installAsAgent });
    }

    closeModal();
  }, { confirmLabel });
}
