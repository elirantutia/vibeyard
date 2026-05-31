import { appState, type SessionRecord } from '../../state.js';
import type { ProviderId } from '../../../shared/types.js';
import { showModal, closeModal, setModalError, FieldDef } from '../modal.js';
import { findInvalidEnvLines } from '../../../shared/env-vars.js';
import { showJoinDialog } from '../join-dialog.js';
import { loadProviderAvailability, getProviderAvailabilitySnapshot } from '../../provider-availability.js';
import { hideTabContextMenu, setActiveContextMenu, positionMenu } from './menu.js';

export function quickNewSession(): void {
  const project = appState.activeProject;
  if (!project) return;
  (document.activeElement as HTMLElement)?.blur?.();
  const sessionNum = project.sessions.length + 1;
  appState.addSession(project.id, `Session ${sessionNum}`);
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
  addItem(swarmActive ? 'Swarm Layout ✓' : 'Swarm Layout', () => appState.toggleSwarm());
  addItem('MCP Inspector', () => addMcpInspector());

  addSeparator();
  addItem('Join Remote Session…', () => showJoinDialog());

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
    { label: 'Name', id: 'session-name', placeholder: `Session ${sessionNum}`, defaultValue: `Session ${sessionNum}` },
    { label: 'Arguments', id: 'session-args', placeholder: 'e.g. --model sonnet', defaultValue: project.defaultArgs ?? '' },
    {
      label: 'Keep args for future sessions',
      id: 'keep-args',
      type: 'checkbox',
      defaultValue: project.defaultArgs ? 'true' : undefined,
    },
    { label: 'Environment Variables', id: 'session-env', type: 'textarea', placeholder: 'KEY=VALUE (one per line)', defaultValue: project.defaultEnv ?? '' },
    {
      label: 'Keep env vars for future sessions',
      id: 'keep-env',
      type: 'checkbox',
      defaultValue: project.defaultEnv ? 'true' : undefined,
    },
  ];

  if (providers.length > 1) {
    const preferred = appState.preferences.defaultProvider ?? 'claude';
    const firstAvailable = (availabilityMap.get(preferred) ? preferred : providers.find(p => availabilityMap.get(p.id))?.id) ?? 'claude';
    fields.unshift({
      label: 'Provider',
      id: 'provider',
      type: 'select',
      defaultValue: firstAvailable,
      options: providers.map(p => {
        const available = availabilityMap.get(p.id);
        return { value: p.id, label: available ? p.displayName : `${p.displayName} (not installed)`, disabled: !available };
      }),
    });
  }

  // Profile picker (Claude only for now). Defaults to the project/global default.
  const claudeProfiles = appState.profiles.filter(p => p.providerId === 'claude');
  if (claudeProfiles.length > 0) {
    fields.push({
      label: 'Profile',
      id: 'profile',
      type: 'select',
      defaultValue: project.defaultProfileId ?? appState.preferences.defaultProfileId ?? '',
      options: [
        { value: '', label: 'Default (~/.claude)' },
        ...claudeProfiles.map(p => ({ value: p.id, label: p.name })),
      ],
    });
  }

  showModal('New Session', fields, (values) => {
    const name = values['session-name']?.trim();
    if (!name) return;

    const envVars = values['session-env']?.trim() || undefined;
    if (envVars) {
      const invalid = findInvalidEnvLines(envVars);
      if (invalid.length > 0) {
        setModalError('session-env', `Use KEY=VALUE — invalid line: ${invalid[0]}`);
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
}

function addMcpInspector(): void {
  const project = appState.activeProject;
  if (!project) return;

  const inspectorNum = project.sessions.filter(s => s.type === 'mcp-inspector').length + 1;
  appState.addMcpInspectorSession(project.id, `Inspector ${inspectorNum}`);
}
