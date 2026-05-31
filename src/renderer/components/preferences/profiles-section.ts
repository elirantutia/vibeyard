import { appState } from '../../state.js';
import { createCustomSelect, type CustomSelectInstance } from '../custom-select.js';
import { showModal, closeModal, setModalError, showConfirmDialog } from '../modal.js';
import type { PreferencesContext, SectionController } from './section.js';

export function createProfilesSection(ctx: PreferencesContext): SectionController {
  let profileDefaultSelect: CustomSelectInstance | null = null;

  function render(container: HTMLElement) {
    if (profileDefaultSelect) { profileDefaultSelect.destroy(); profileDefaultSelect = null; }

    const heading = document.createElement('div');
    heading.className = 'preferences-subheading';
    heading.textContent = 'Claude profiles';
    container.appendChild(heading);

    const desc = document.createElement('div');
    desc.className = 'preferences-section-desc';
    desc.textContent = 'Each profile runs Claude Code against its own config directory (CLAUDE_CONFIG_DIR), isolating login, settings, and history — handy for separate work and personal licenses. After creating a profile, start a session with it and run /login once to sign in.';
    container.appendChild(desc);

    const profiles = appState.profiles.filter((p) => p.providerId === 'claude');

    // Default profile selector (global fallback)
    const defaultRow = document.createElement('div');
    defaultRow.className = 'modal-toggle-field';
    const defaultLabel = document.createElement('label');
    defaultLabel.textContent = 'Default profile';
    profileDefaultSelect = createCustomSelect(
      'pref-default-profile',
      [{ value: '', label: 'Default (~/.claude)' }, ...profiles.map((p) => ({ value: p.id, label: p.name }))],
      appState.preferences.defaultProfileId ?? '',
      (value) => appState.setPreference('defaultProfileId', value || undefined),
    );
    defaultRow.appendChild(defaultLabel);
    defaultRow.appendChild(profileDefaultSelect.element);
    container.appendChild(defaultRow);

    // Profile list
    const list = document.createElement('div');
    list.className = 'profiles-list';
    if (profiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'profiles-empty';
      empty.textContent = 'No profiles yet.';
      list.appendChild(empty);
    } else {
      for (const profile of profiles) {
        const row = document.createElement('div');
        row.className = 'profile-row';

        const info = document.createElement('div');
        info.className = 'profile-row-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'profile-row-name';
        nameEl.textContent = profile.name;
        const tag = document.createElement('span');
        tag.className = 'profile-row-tag';
        tag.textContent = profile.managed ? 'managed' : 'custom';
        nameEl.appendChild(tag);
        const pathEl = document.createElement('div');
        pathEl.className = 'profile-row-path';
        pathEl.textContent = profile.configDir;
        info.appendChild(nameEl);
        info.appendChild(pathEl);

        const actions = document.createElement('div');
        actions.className = 'profile-row-actions';
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-secondary btn-sm';
        editBtn.textContent = 'Rename';
        editBtn.addEventListener('click', () => promptEditProfile(profile.id, profile.name));
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn-secondary btn-sm danger';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', () => {
          showConfirmDialog(
            'Delete profile',
            `Delete profile "${profile.name}"? Sessions and projects using it fall back to the default config dir. The config directory on disk is not removed.`,
            {
              confirmLabel: 'Delete',
              onConfirm: () => {
                appState.removeProfile(profile.id);
                ctx.rerenderSection('profiles');
              },
            },
          );
        });
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);

        row.appendChild(info);
        row.appendChild(actions);
        list.appendChild(row);
      }
    }
    container.appendChild(list);

    const addBtn = document.createElement('button');
    addBtn.className = 'config-section-add-btn';
    addBtn.textContent = '+ Add Profile';
    addBtn.addEventListener('click', promptAddProfile);
    container.appendChild(addBtn);
  }

  function promptAddProfile() {
    showModal('Add Profile', [
      { label: 'Name', id: 'profile-name', placeholder: 'e.g. Work' },
      { label: 'Custom config path (optional)', id: 'profile-path', placeholder: 'Leave blank for a managed directory' },
    ], async (values) => {
      const name = values['profile-name']?.trim();
      if (!name) { setModalError('profile-name', 'Name is required'); return; }
      const customPath = values['profile-path']?.trim() || undefined;
      try {
        await appState.addProfile({ name, providerId: 'claude', customPath });
      } catch (err) {
        setModalError('profile-path', `Could not create config directory: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      closeModal();
      ctx.rerenderSection('profiles');
    });
  }

  function promptEditProfile(id: string, currentName: string) {
    showModal('Rename Profile', [
      { label: 'Name', id: 'profile-name', defaultValue: currentName },
    ], (values) => {
      const name = values['profile-name']?.trim();
      if (!name) { setModalError('profile-name', 'Name is required'); return; }
      appState.updateProfile(id, { name });
      closeModal();
      ctx.rerenderSection('profiles');
    });
  }

  return {
    render,
    destroy() {
      if (profileDefaultSelect) { profileDefaultSelect.destroy(); profileDefaultSelect = null; }
    },
  };
}
