import { appState } from '../../../state.js';
import { openFileReaderChecked } from '../../../open-file-reader.js';
import { showMcpAddModal } from '../../mcp-add-modal.js';
import { createCustomSelect, type CustomSelectInstance } from '../../custom-select.js';
import {
  getAvailableProviderMetas,
  getProviderAvailabilitySnapshot,
  loadProviderAvailability,
} from '../../../provider-availability.js';
import type { ProviderConfig, ProviderId, McpServer, Agent, Skill, Command } from '../../../types.js';
import type { WidgetFactory, WidgetHost, WidgetInstance } from './widget-host.js';
import { resolveProfile } from '../../../state/specialized-sessions.js';
function scopeBadgeEl(scope: 'user' | 'project'): HTMLElement {
  const el = document.createElement('span');
  el.className = `scope-badge ${scope}`;
  el.textContent = scope;
  return el;
}

export const createProviderToolsWidget: WidgetFactory = (host: WidgetHost): WidgetInstance => {
  const projectId = host.projectId;
  const root = document.createElement('div');
  root.className = 'project-tab-provider-tools widget-provider-tools';

  const toolbar = document.createElement('div');
  toolbar.className = 'widget-provider-tools-toolbar';
  root.appendChild(toolbar);

  const body = document.createElement('div');
  body.className = 'project-tab-tools-body';
  body.innerHTML = '<div class="config-loading">Loading...</div>';
  root.appendChild(body);

  // Per-instance provider selection (don't share across widget instances).
  let selectedProviderId: ProviderId | null = null;
  let providerSelect: CustomSelectInstance | null = null;
  let lastAvailableKey: string | null = null;
  let unsubConfigChanged: (() => void) | null = null;
  let destroyed = false;

  const getActiveProviderId = (): ProviderId => {
    const available = getAvailableProviderMetas().map(p => p.id);
    if (selectedProviderId && available.includes(selectedProviderId)) return selectedProviderId;
    if (available.length > 0) return available[0];
    return 'claude';
  };

  const getProjectPath = (): string | null => {
    const p = appState.projects.find(pr => pr.id === projectId);
    return p?.path ?? null;
  };

  /**
   * The config dir this project's next session under `providerId` will actually
   * run with, resolved through the same chain the spawn path uses (project pin
   * → the provider's global default). Sharing that resolution is load-bearing:
   * the widget must not show one login's MCP servers for a project that runs as
   * another. Undefined means "use the provider's default dir".
   */
  const getEffectiveConfigDir = (providerId: ProviderId): string | undefined => {
    const project = appState.projects.find(pr => pr.id === projectId);
    if (!project) return undefined;
    const profile = resolveProfile(undefined, project, appState.preferences, providerId, appState.profiles);
    return profile?.configDir;
  };

  /**
   * Build the name/detail/badge row from DOM nodes. The previous shape used
   * innerHTML with esc() on every field; textContent removes the injection
   * surface entirely and lets every item builder share one code path.
   */
  const configItem = (name: string, detail: string, scope: 'user' | 'project'): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'config-item config-item-clickable';
    const nameEl = document.createElement('span');
    nameEl.className = 'config-item-name';
    nameEl.textContent = name;
    const detailEl = document.createElement('span');
    detailEl.className = 'config-item-detail';
    detailEl.textContent = detail;
    el.append(nameEl, detailEl, scopeBadgeEl(scope));
    return el;
  };

  const mcpItem = (server: McpServer, projectPath: string): HTMLElement => {
    const el = configItem(server.name, server.status, server.scope);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'config-item-remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove server';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove MCP server "${server.name}"?`)) return;
      await window.vibeyard.mcp.removeServer(server.name, server.filePath, server.scope, projectPath);
      void refresh();
    });
    el.appendChild(removeBtn);

    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.config-item-remove-btn')) return;
      openConfigFile(server.filePath);
    });
    return el;
  };

  const agentItem = (agent: Agent): HTMLElement => {
    const el = configItem(agent.name, agent.model, agent.scope);
    el.addEventListener('click', () => openConfigFile(agent.filePath));
    return el;
  };

  const skillItem = (skill: Skill): HTMLElement => {
    const el = configItem(skill.name, skill.description, skill.scope);
    el.addEventListener('click', () => openConfigFile(skill.filePath));
    return el;
  };

  const commandItem = (cmd: Command): HTMLElement => {
    const el = configItem(`/${cmd.name}`, cmd.description, cmd.scope);
    el.addEventListener('click', () => openConfigFile(cmd.filePath));
    return el;
  };

  const openConfigFile = (filePath: string) => {
    if (!filePath) return;
    void openFileReaderChecked(projectId, filePath);
  };

  const renderSection = (title: string, items: HTMLElement[], count: number, onAdd?: () => void): HTMLElement => {
    const section = document.createElement('div');
    section.className = 'config-section project-tab-tools-section';

    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'config-section-header';
    const countEl = document.createElement('span');
    countEl.className = 'config-section-count';
    countEl.textContent = String(count);
    // Bare text node for the title keeps the original markup shape intact.
    sectionHeader.append(title, countEl);

    if (onAdd) {
      const addBtn = document.createElement('button');
      addBtn.className = 'config-section-add-btn';
      addBtn.textContent = '+';
      addBtn.title = `Add ${title.replace(/s$/, '')}`;
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); onAdd(); });
      sectionHeader.appendChild(addBtn);
    }

    const sectionBody = document.createElement('div');
    sectionBody.className = 'config-section-body';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'config-empty';
      empty.textContent = 'None configured';
      sectionBody.appendChild(empty);
    } else {
      items.forEach(el => sectionBody.appendChild(el));
    }

    section.appendChild(sectionHeader);
    section.appendChild(sectionBody);
    return section;
  };

  const destroyProviderSelect = () => {
    if (providerSelect) {
      providerSelect.element.remove();
      providerSelect.destroy();
      providerSelect = null;
    }
  };

  const watchActiveProvider = () => {
    const projectPath = getProjectPath();
    if (!projectPath) return;
    window.vibeyard.provider.watchProject(getActiveProviderId(), projectPath);
  };

  const buildToolbarSelect = () => {
    const available = getAvailableProviderMetas();
    const key = available.map(p => p.id).join(',');
    const wantSelect = available.length > 1;
    if (key === lastAvailableKey && wantSelect === !!providerSelect) return;
    lastAvailableKey = key;

    destroyProviderSelect();

    if (wantSelect) {
      providerSelect = createCustomSelect(
        `widget-provider-select-${host.widgetId}`,
        available.map(p => ({ value: p.id, label: p.displayName })),
        getActiveProviderId(),
        (value) => {
          selectedProviderId = value as ProviderId;
          watchActiveProvider();
          void refresh();
        },
      );
      toolbar.appendChild(providerSelect.element);
    }
  };

  const refresh = async () => {
    if (destroyed) return;

    if (!getProviderAvailabilitySnapshot()) {
      await loadProviderAvailability();
    }
    if (destroyed) return;

    buildToolbarSelect();

    const providerId = getActiveProviderId();
    const projectPath = getProjectPath();
    if (!projectPath) {
      body.innerHTML = '';
      return;
    }

    let config: ProviderConfig;
    try {
      config = await window.vibeyard.provider.getConfig(
        providerId,
        projectPath,
        getEffectiveConfigDir(providerId)
      );
    } catch {
      body.innerHTML = '';
      return;
    }
    if (destroyed) return;

    body.innerHTML = '';

    body.appendChild(renderSection(
      'MCP Servers',
      config.mcpServers.map(s => mcpItem(s, projectPath)),
      config.mcpServers.length,
      providerId === 'claude' ? () => showMcpAddModal(() => void refresh()) : undefined,
    ));

    body.appendChild(renderSection(
      'Agents',
      config.agents.map(agentItem),
      config.agents.length,
    ));

    body.appendChild(renderSection(
      'Skills',
      config.skills.map(skillItem),
      config.skills.length,
    ));

    if (providerId !== 'codex' && providerId !== 'copilot') {
      body.appendChild(renderSection(
        'Commands',
        config.commands.map(commandItem),
        config.commands.length,
      ));
    }
  };

  watchActiveProvider();
  void refresh();

  unsubConfigChanged = window.vibeyard.provider.onConfigChanged(() => {
    void refresh();
  });

  return {
    element: root,
    destroy() {
      destroyed = true;
      destroyProviderSelect();
      unsubConfigChanged?.();
      unsubConfigChanged = null;
    },
    refresh() {
      void refresh();
    },
  };
};
