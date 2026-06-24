import { appState, type SessionRecord } from '../../state.js';
import type { ProviderId } from '../../../shared/types.js';
import { showModal, closeModal, setModalError, FieldDef } from '../modal.js';
import { findInvalidEnvLines } from '../../../shared/env-vars.js';
import { showJoinDialog } from '../join-dialog.js';
import { loadProviderAvailability, getProviderAvailabilitySnapshot } from '../../provider-availability.js';
import { hideTabContextMenu, setActiveContextMenu, positionMenu } from './menu.js';
import { t } from '../../i18n.js';

export function quickNewSession(): void {
  const project = appState.activeProject;
  if (!project) return;
  (document.activeElement as HTMLElement)?.blur?.();
  const sessionNum = project.sessions.length + 1;
  appState.addSession(project.id, t('tab.newSession.defaultName', { num: sessionNum }));
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

  const sessionNum = project.sessions.length + 1;

  let providerSnapshot = getProviderAvailabilitySnapshot();
  if (!providerSnapshot) {
    await loadProviderAvailability();
    providerSnapshot = getProviderAvailabilitySnapshot();
  }
  const providers = providerSnapshot?.providers ?? [];
  const availabilityMap = providerSnapshot?.availability ?? new Map();

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

  const preferred = appState.preferences.defaultProvider ?? 'claude';
  const effectiveProvider = (availabilityMap.get(preferred) ? preferred : providers.find(p => availabilityMap.get(p.id))?.id) ?? 'claude';
  if (providers.length > 1) {
    fields.unshift({
      label: t('tab.newSessionModal.providerLabel'),
      id: 'provider',
      type: 'select',
      defaultValue: effectiveProvider,
      onSelectChange: (value) => setProfileFieldVisible(value === 'claude'),
      options: providers.map(p => {
        const available = availabilityMap.get(p.id);
        return { value: p.id, label: available ? p.displayName : t('tab.newSessionModal.providerNotInstalled', { name: p.displayName }), disabled: !available };
      }),
    });
  }

  // Profile picker (Claude only). Defaults to the project/global default.
  const claudeProfiles = appState.profiles.filter(p => p.providerId === 'claude');
  if (claudeProfiles.length > 0) {
    fields.push({
      label: t('tab.newSessionModal.profileLabel'),
      id: 'profile',
      type: 'select',
      defaultValue: project.defaultProfileId ?? appState.preferences.defaultProfileId ?? '',
      options: [
        { value: '', label: t('sidebar.defaultProfileOption') },
        ...claudeProfiles.map(p => ({ value: p.id, label: p.name })),
      ],
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
    // Profiles only apply to Claude; ignore the field for other providers.
    const profileId = providerId === 'claude' ? (values['profile'] || undefined) : undefined;
    const session = appState.addSession(project.id, name, args, providerId, profileId, envVars);
    if (session && onCreated) onCreated(session);
  });

  // Profiles only apply to Claude — hide the field when the dialog opens
  // defaulted to a non-Claude provider. The provider select's onSelectChange
  // keeps it in sync as the user switches.
  if (claudeProfiles.length > 0) setProfileFieldVisible(effectiveProvider === 'claude');
}

/** Toggle the Profile field's wrapper in the open New Session modal. */
function setProfileFieldVisible(visible: boolean): void {
  const wrapper = document.getElementById('modal-profile')?.closest('.modal-field') as HTMLElement | null;
  if (wrapper) wrapper.style.display = visible ? '' : 'none';
}

function addMcpInspector(): void {
  const project = appState.activeProject;
  if (!project) return;

  const inspectorNum = project.sessions.filter(s => s.type === 'mcp-inspector').length + 1;
  appState.addMcpInspectorSession(project.id, t('tab.newMcpInspector.defaultName', { num: inspectorNum }));
}
