import { appState } from '../state.js';
import type { ProjectRecord, ProviderId } from '../../shared/types.js';
import { providerProfileOptions } from '../profile-utils.js';
import { getCachedProviderMetas } from '../provider-availability.js';
import { t } from '../i18n.js';
import { showModal, closeModal } from './modal.js';
import type { CustomSelectInstance } from './custom-select.js';
/** Defaults for new sessions; existing sessions retain their pinned identity. */
export function promptProjectSettings(project: ProjectRecord): void {
  let profileSelect: CustomSelectInstance | undefined;
  const effectiveProvider = (value: string) => (value || appState.preferences.defaultProvider || 'claude') as ProviderId;
  const profileOptions = (value: string) => [
    { value: '', label: t('sidebar.defaultProfileOption') },
    ...providerProfileOptions(effectiveProvider(value)),
  ];
  showModal(t('sidebar.projectSettings.title'), [
    {
      label: t('tab.newSessionModal.providerLabel'),
      id: 'provider',
      type: 'select',
      defaultValue: project.defaultProvider ?? '',
      options: [
        { value: '', label: t('sidebar.defaultProfileOption') },
        ...getCachedProviderMetas().map(p => ({ value: p.id, label: p.displayName })),
      ],
      onSelectChange: value => profileSelect?.setOptions(profileOptions(value), ''),
    },
    {
      label: t('sidebar.projectSettings.defaultProfileLabel'),
      id: 'profile',
      type: 'select',
      defaultValue: project.defaultProfileId ?? '',
      options: profileOptions(project.defaultProvider ?? ''),
      onSelectCreated: select => { profileSelect = select; },
    },
  ], (values) => {
    appState.setProjectCodingDefaults(project.id, (values['provider'] || undefined) as ProviderId | undefined, values['profile'] || undefined);
    closeModal();
  }, { confirmLabel: 'Save' });
}
