import { appState } from '../../state.js';
import { isMac } from '../../platform.js';
import { createCustomSelect, type CustomSelectInstance } from '../custom-select.js';
import { showModal, closeModal, setModalError, showConfirmDialog, type FieldDef } from '../modal.js';
import { t } from '../../i18n.js';
import { loadProviderAvailability, getAvailableProviderMetas, getCachedProviderMetas, getProviderDisplayName } from '../../provider-availability.js';
import { profileCapableProfiles } from '../../profile-utils.js';
import type { Profile, ProviderId } from '../../../shared/types.js';
import type { PreferencesContext, SectionController } from './section.js';

export function createProfilesSection(ctx: PreferencesContext): SectionController {
  let profileDefaultSelects: CustomSelectInstance[] = [];
  // Cached keychain-isolation status (macOS), fetched once per render and reused
  // by the Add Profile guard so it doesn't re-probe the keychain via IPC.
  let cachedKeychainStatus: Awaited<ReturnType<typeof window.vibeyard.profiles.keychainStatus>> | null = null;

  function render(container: HTMLElement) {
    for (const s of profileDefaultSelects) s.destroy();
    profileDefaultSelects = [];

    const heading = document.createElement('div');
    heading.className = 'preferences-subheading';
    heading.textContent = t('profiles.heading');
    container.appendChild(heading);

    const desc = document.createElement('div');
    desc.className = 'preferences-section-desc';
    desc.textContent = t('profiles.description');
    container.appendChild(desc);

    // Per-provider setup hints (today: Claude, Pi + OMP, the profile-capable CLIs).
    for (const hintKey of ['profiles.descriptionClaude', 'profiles.descriptionPi', 'profiles.descriptionOmp']) {
      const hint = document.createElement('div');
      hint.className = 'preferences-section-desc';
      hint.textContent = t(hintKey);
      container.appendChild(hint);
    }

    // macOS-only guardrail notice: per-profile login isolation depends on Claude
    // Code namespacing its keychain entry per config dir. Older builds share one
    // entry, so logins would bleed across profiles. Surface the status inline.
    if (isMac) {
      const warnSlot = document.createElement('div');
      container.appendChild(warnSlot);
      void window.vibeyard.profiles.keychainStatus().then((res) => {
        cachedKeychainStatus = res;
        if (res.status === 'supported') return;
        const warn = document.createElement('div');
        warn.className = res.status === 'unsupported' ? 'profiles-keychain-warning' : 'profiles-keychain-warning info';
        warn.textContent = res.status === 'unsupported'
          ? t('profiles.keychainUnsupported', { version: res.version ? ` (${res.version})` : '' })
          : t('profiles.keychainUnknown');
        warnSlot.appendChild(warn);
      }).catch(() => { /* status check is best-effort */ });
    }

    // All profile-capable providers (capabilities.profiles), not just Claude.
    const profiles = profileCapableProfiles();

    // Group profiles by provider. Groups are ordered by the provider
    // registry (the same order the rest of the UI lists coding tools), so a
    // new profile-capable CLI gets its own group automatically; a provider
    // with profiles but no registry meta sorts last, stably.
    const byProvider = new Map<ProviderId, Profile[]>();
    for (const p of profiles) {
      const list = byProvider.get(p.providerId) ?? [];
      list.push(p);
      byProvider.set(p.providerId, list);
    }
    const metaOrder = new Map(getCachedProviderMetas().map((m, i) => [m.id, i] as const));
    const providerIds = [...byProvider.keys()].sort((a, b) => {
      const ia = metaOrder.has(a) ? (metaOrder.get(a) as number) : Number.MAX_SAFE_INTEGER;
      const ib = metaOrder.has(b) ? (metaOrder.get(b) as number) : Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });
    for (const providerId of providerIds) {
      const providerProfiles = byProvider.get(providerId)!;
      const row = document.createElement('div');
      row.className = 'modal-toggle-field';
      const label = document.createElement('label');
      label.textContent = getProviderDisplayName(providerId);
      const select = createCustomSelect(
        `pref-default-profile-${providerId}`,
        [{ value: '', label: t('sidebar.defaultProfileOption') }, ...providerProfiles.map((p) => ({ value: p.id, label: p.name }))],
        appState.preferences.defaultProfiles?.[providerId] ?? '',
        (value) => appState.setProviderDefaultProfile(providerId, value || undefined),
      );
      profileDefaultSelects.push(select);
      row.appendChild(label);
      row.appendChild(select.element);
      container.appendChild(row);
    }

    // One profile row: name + managed/custom tag, config dir, actions. The
    // provider is carried by the group heading, so no per-row provider tag.
    function buildProfileRow(profile: Profile): HTMLElement {
      const row = document.createElement('div');
      row.className = 'profile-row';

      const info = document.createElement('div');
      info.className = 'profile-row-info';
      const nameEl = document.createElement('div');
      nameEl.className = 'profile-row-name';
      nameEl.textContent = profile.name;
      const tag = document.createElement('span');
      tag.className = 'profile-row-tag';
      tag.textContent = profile.managed ? t('profiles.tagManaged') : t('profiles.tagCustom');
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
      editBtn.textContent = t('profiles.renameButton');
      editBtn.addEventListener('click', () => promptEditProfile(profile.id, profile.name));
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn-secondary btn-sm danger';
      deleteBtn.textContent = t('profiles.deleteButton');
      deleteBtn.disabled = appState.isProfileInUse(profile.id);
      if (deleteBtn.disabled) deleteBtn.title = 'Close sessions and remove session history using this profile before deleting it.';
      deleteBtn.addEventListener('click', () => {
        showConfirmDialog(
          t('profiles.deleteTitle'),
          t('profiles.deleteMessage', { name: profile.name }),
          {
            confirmLabel: t('profiles.deleteConfirm'),
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
      return row;
    }

    // Profile list — grouped by provider, one heading per coding tool.
    const list = document.createElement('div');
    list.className = 'profiles-list';
    if (profiles.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'profiles-empty';
      empty.textContent = t('profiles.empty');
      list.appendChild(empty);
    } else {
      for (const providerId of providerIds) {
        const group = document.createElement('div');
        group.className = 'profile-group';
        const groupHeading = document.createElement('div');
        groupHeading.className = 'profile-group-heading';
        groupHeading.textContent = getProviderDisplayName(providerId);
        group.appendChild(groupHeading);
        for (const profile of byProvider.get(providerId)!) {
          group.appendChild(buildProfileRow(profile));
        }
        list.appendChild(group);
      }
    }
    container.appendChild(list);

    const addRow = document.createElement('div');
    addRow.className = 'profiles-add-row';
    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary';
    addBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
      'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' +
      `<path d="M12 5v14M5 12h14"/></svg><span>${t('profiles.addButton')}</span>`;
    addBtn.addEventListener('click', promptAddProfile);
    addRow.appendChild(addBtn);
    container.appendChild(addRow);
  }

  async function promptAddProfile() {
    await loadProviderAvailability();
    const profileCapable = getAvailableProviderMetas().filter((p) => p.capabilities.profiles);
    const fields: FieldDef[] = [
      { label: t('profiles.addNameLabel'), id: 'profile-name', placeholder: t('profiles.addNamePlaceholder') },
      {
        label: t('profiles.addProviderLabel'),
        id: 'profile-provider',
        type: 'select',
        defaultValue: 'claude',
        options: profileCapable.map((p) => ({ value: p.id, label: p.displayName })),
      },
      { label: t('profiles.addPathLabel'), id: 'profile-path', placeholder: t('profiles.addPathPlaceholder') },
    ];
    showModal(t('profiles.addModalTitle'), fields, async (values) => {
      const name = values['profile-name']?.trim();
      if (!name) { setModalError('profile-name', t('profiles.nameRequired')); return; }
      const providerId = (values['profile-provider'] || 'claude') as ProviderId;
      // Block creation when this Claude build can't isolate profile logins on
      // macOS — otherwise the new profile would silently share the default
      // account's keychain login. Other providers have no keychain concern.
      if (isMac && providerId === 'claude') {
        const { status, version } = cachedKeychainStatus ?? await window.vibeyard.profiles.keychainStatus();
        if (status === 'unsupported') {
          setModalError('profile-name', t('profiles.unsupportedMacError', { version: version ? ` ${version}` : '' }));
          return;
        }
      }
      const customPath = values['profile-path']?.trim() || undefined;
      try {
        await appState.addProfile({ name, providerId, customPath });
      } catch (err) {
        setModalError('profile-path', t('profiles.createDirError', { err: err instanceof Error ? err.message : String(err) }));
        return;
      }
      closeModal();
      ctx.rerenderSection('profiles');
    });
  }

  function promptEditProfile(id: string, currentName: string) {
    showModal(t('profiles.renameModalTitle'), [
      { label: t('profiles.renameNameLabel'), id: 'profile-name', defaultValue: currentName },
    ], (values) => {
      const name = values['profile-name']?.trim();
      if (!name) { setModalError('profile-name', t('profiles.nameRequired')); return; }
      appState.updateProfile(id, { name });
      closeModal();
      ctx.rerenderSection('profiles');
    });
  }

  return {
    render,
    destroy() {
      for (const s of profileDefaultSelects) s.destroy();
      profileDefaultSelects = [];
    },
  };
}
