import { appState, type SessionRecord } from '../../state.js';
import type { ProviderId } from '../../../shared/types.js';
import { showModal, closeModal, setModalError, FieldDef } from '../modal.js';
import { findInvalidEnvLines } from '../../../shared/env-vars.js';
import { showJoinDialog } from '../join-dialog.js';
import { loadProviderAvailability, getProviderAvailabilitySnapshot, getProviderCapabilities } from '../../provider-availability.js';
import { providerProfileOptions } from '../../profile-utils.js';
import type { CustomSelectInstance } from '../custom-select.js';
import { hideTabContextMenu, setActiveContextMenu, positionMenu } from './menu.js';
import { t } from '../../i18n.js';
import { defaultSessionName, nextNumberFor, nextSessionNumber, MCP_INSPECTOR_NAME_KEY } from '../../state/session-naming.js';

export function quickNewSession(): void {
  const project = appState.activeProject;
  if (!project) return;
  (document.activeElement as HTMLElement)?.blur?.();
  appState.addSession(project.id, defaultSessionName(project));
}

// "More" overflow menu. Deliberately excludes actions that have their own
// toolbar icon (Terminal, Browser) and the New/Custom Session actions
// (those live on the pill + its caret).
export function showMoreMenu(x: number, y: number): void {
  hideTabContextMenu();

  const menu = document.createElement('div');
  menu.className = 'tab-context-menu';
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  const addItem = (label: string, onClick: () => void): void => {
    const item = document.createElement('div');
    item.className = 'tab-context-menu-item';
    item.textContent = label;
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      hideTabContextMenu();
      onClick();
    });
    menu.appendChild(item);
  };

  const addSeparator = (): void => {
    const sep = document.createElement('div');
    sep.className = 'tab-context-menu-separator';
    menu.appendChild(sep);
  };

  const swarmActive = appState.activeProject?.layout.mode === 'swarm';
  addItem(swarmActive ? t('tab.moreMenu.swarmLayoutActive') : t('tab.moreMenu.swarmLayout'), () => appState.toggleSwarm());
  addItem(t('tab.moreMenu.mcpInspector'), () => addMcpInspector());

  addSeparator();
  addItem(t('tab.moreMenu.joinRemoteSession'), () => showJoinDialog());

  document.body.appendChild(menu);
  setActiveContextMenu(menu);

  positionMenu(menu);
}

export async function promptNewSession(onCreated?: (session: SessionRecord) => void): Promise<void> {
  const project = appState.activeProject;
  if (!project) return;

  const sessionNum = nextSessionNumber(project);

  let providerSnapshot = getProviderAvailabilitySnapshot();
  if (!providerSnapshot) {
    await loadProviderAvailability();
    providerSnapshot = getProviderAvailabilitySnapshot();
  }
  const providers = providerSnapshot?.providers ?? [];
  const availabilityMap = providerSnapshot?.availability ?? new Map();
  // The profile select instance, captured when the modal builds it so the
  // provider change can re-scope its options in place.
  let profileSelect: CustomSelectInstance | null = null;

  // Re-scope the Profile field of the open New Session modal to one coding
  // tool: show it only when the tool has profiles, and swap in that tool's
  // profiles (bare names). `selected` is kept when it belongs to the tool;
  // otherwise the selection falls back to "Default", since a profile from a
  // different tool no longer applies.
  function setProfileFieldProvider(providerId: ProviderId, selected = ''): void {
    const wrapper = document.getElementById('modal-profile')?.closest('.modal-field') as HTMLElement | null;
    if (!wrapper) return;
    const profiles = providerProfileOptions(providerId);
    wrapper.style.display = profiles.length > 0 ? '' : 'none';
    profileSelect?.setOptions([
      { value: '', label: t('sidebar.defaultProfileOption') },
      ...profiles,
    ], selected);
  }

  const fields: FieldDef[] = [
    { label: t('tab.newSessionModal.nameLabel'), id: 'session-name', placeholder: t('tab.newSessionModal.namePlaceholder', { num: sessionNum }), defaultValue: t('tab.newSessionModal.namePlaceholder', { num: sessionNum }) },
    { label: t('tab.newSessionModal.argumentsLabel'), id: 'session-args', placeholder: t('tab.newSessionModal.argumentsPlaceholder'), defaultValue: project.defaultArgs ?? '' },
    {
      label: t('tab.newSessionModal.keepArgsLabel'),
      id: 'keep-args',
      type: 'checkbox',
      defaultValue: project.defaultArgs ? 'true' : undefined,
    },
    { label: t('tab.newSessionModal.envLabel'), id: 'session-env', type: 'textarea', placeholder: t('tab.newSessionModal.envPlaceholder'), defaultValue: project.defaultEnv ?? '' },
    {
      label: t('tab.newSessionModal.keepEnvLabel'),
      id: 'keep-env',
      type: 'checkbox',
      defaultValue: project.defaultEnv ? 'true' : undefined,
    },
  ];

  const preferred = project.defaultProvider ?? appState.preferences.defaultProvider ?? 'claude';
  const effectiveProvider = (availabilityMap.get(preferred) ? preferred : providers.find(p => availabilityMap.get(p.id))?.id) ?? 'claude';
  if (providers.length > 1) {
    fields.unshift({
      label: t('tab.newSessionModal.providerLabel'),
      id: 'provider',
      type: 'select',
      defaultValue: effectiveProvider,
      onSelectChange: (value) => setProfileFieldProvider(value as ProviderId),
      options: providers.map(p => {
        const available = availabilityMap.get(p.id);
        return { value: p.id, label: available ? p.displayName : t('tab.newSessionModal.providerNotInstalled', { name: p.displayName }), disabled: !available };
      }),
    });
  }

  // Profile picker — scoped to the selected coding tool (bare names, no
  // provider suffix). Offered when any available provider has profiles; the
  // provider select's onSelectChange re-scopes the list and hides the field
  // when the tool has none.
  const anyProviderHasProfiles = providers.some((p) => providerProfileOptions(p.id as ProviderId).length > 0);
  const initialProfileValue = project.defaultProfileId ?? appState.preferences.defaultProfiles?.[effectiveProvider as ProviderId] ?? '';
  if (anyProviderHasProfiles) {
    fields.push({
      label: t('tab.newSessionModal.profileLabel'),
      id: 'profile',
      type: 'select',
      defaultValue: initialProfileValue,
      options: [
        { value: '', label: t('sidebar.defaultProfileOption') },
        ...providerProfileOptions(effectiveProvider as ProviderId),
      ],
      onSelectCreated: (select) => { profileSelect = select; },
    });
  }

  showModal(t('tab.newSessionModal.title'), fields, (values) => {
    const name = values['session-name']?.trim();
    if (!name) return;

    const envVars = values['session-env']?.trim() || undefined;
    if (envVars) {
      const invalid = findInvalidEnvLines(envVars);
      if (invalid.length > 0) {
        setModalError('session-env', t('tab.newSessionModal.envError', { line: invalid[0] }));
        return;
      }
    }

    closeModal();
    const args = values['session-args']?.trim() || undefined;
    const keepArgs = values['keep-args'] === 'true';
    project.defaultArgs = keepArgs ? (args || undefined) : undefined;
    const keepEnv = values['keep-env'] === 'true';
    project.defaultEnv = keepEnv ? (envVars || undefined) : undefined;
    const providerId = (values['provider'] || 'claude') as ProviderId;
    // Profiles only apply to profile-capable providers; ignore the field
    // for the rest.
    const profileId = getProviderCapabilities(providerId)?.profiles === true ? (values['profile'] || undefined) : undefined;
    const session = appState.addSession(project.id, name, args, providerId, profileId, envVars);
    if (session && onCreated) onCreated(session);
  });

  // Re-scope the profile list to the provider the dialog opened with,
  // keeping the project/global default when it belongs to that tool.
  setProfileFieldProvider(effectiveProvider as ProviderId, initialProfileValue);
}

function addMcpInspector(): void {
  const project = appState.activeProject;
  if (!project) return;

  const inspectorNum = nextNumberFor(MCP_INSPECTOR_NAME_KEY, project);
  appState.addMcpInspectorSession(project.id, t('tab.newMcpInspector.defaultName', { num: inspectorNum }));
}
