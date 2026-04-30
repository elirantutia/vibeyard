import type { TeamMember } from '../../../shared/types.js';
import { appState } from '../../state.js';
import { showModal, closeModal, setModalError, type FieldDef } from '../modal.js';

export function showTeamMemberModal(mode: 'create' | 'edit', existing?: TeamMember): void {
  const fields: FieldDef[] = [
    { label: 'Name', id: 'name', placeholder: 'Sarah', defaultValue: existing?.name ?? '' },
    { label: 'Role', id: 'role', placeholder: 'Chief Marketing Officer', defaultValue: existing?.role ?? '' },
    { label: 'Description', id: 'description', placeholder: 'Strategic marketing leadership', defaultValue: existing?.description ?? '' },
    {
      label: 'System prompt',
      id: 'systemPrompt',
      type: 'textarea',
      placeholder: 'You are the Chief Marketing Officer of...',
      defaultValue: existing?.systemPrompt ?? '',
      rows: 16,
    },
  ];

  const title = mode === 'create' ? 'New Team Member' : 'Edit Team Member';
  const confirmLabel = mode === 'create' ? 'Create' : 'Save';

  showModal(title, fields, (values) => {
    const name = values.name?.trim() ?? '';
    const role = values.role?.trim() ?? '';
    const systemPrompt = values.systemPrompt?.trim() ?? '';

    if (!name) { setModalError('name', 'Name is required'); return; }
    if (!role) { setModalError('role', 'Role is required'); return; }
    if (!systemPrompt) { setModalError('systemPrompt', 'System prompt is required'); return; }

    const description = values.description?.trim() || undefined;

    if (mode === 'create') {
      appState.addTeamMember({
        name,
        role,
        description,
        systemPrompt,
        source: 'custom',
      });
    } else if (existing) {
      appState.updateTeamMember(existing.id, { name, role, description, systemPrompt });
    }

    closeModal();
  }, { confirmLabel });
}
