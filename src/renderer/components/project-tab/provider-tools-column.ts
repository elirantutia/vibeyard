import { appState, ProjectRecord } from '../../state.js';
import { showMcpAddModal } from '../mcp-add-modal.js';
import { createCustomSelect, type CustomSelectInstance } from '../custom-select.js';
import { esc } from '../../dom-utils.js';
import {
  getAvailableProviderMetas,
  getProviderAvailabilitySnapshot,
  loadProviderAvailability,
} from '../../provider-availability.js';
import type { ProviderConfig, ProviderId, McpServer, Agent, Skill, Command } from '../../types.js';

export interface ProviderToolsColumnInstance {
  element: HTMLElement;
  destroy(): void;
}

const selectedProviderByProject = new Map<string, ProviderId>();

function getActiveProviderId(projectId: string): ProviderId {
  const available = getAvailableProviderMetas().map(p => p.id);
  const stored = selectedProviderByProject.get(projectId);
  if (stored && available.includes(stored)) return stored;
  if (available.length > 0) return available[0];
  return 'claude';
}

function scopeBadge(scope: 'user' | 'project'): string {
  return `<span class="scope-badge ${scope}">${scope}</span>`;
}

export function createProviderToolsColumn(project: ProjectRecord): ProviderToolsColumnInstance {
  const root = document.createElement('div');
  root.className = 'project-tab-column project-tab-provider-tools';

  let providerSelect: CustomSelectInstance | null = null;
  let unsubConfigChanged: (() => void) | null = null;
  let destroyed = false;

  const mcpItem = (server: McpServer): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'config-item config-item-clickable';
    el.innerHTML = `<span class="config-item-name">${esc(server.name)}</span><span class="config-item-detail">${esc(server.status)}</span>${scopeBadge(server.scope)}`;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'config-item-remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove server';
    removeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove MCP server "${server.name}"?`)) return;
      await window.vibeyard.mcp.removeServer(server.name, server.filePath, server.scope, project.path);
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
    const el = document.createElement('div');
    el.className = 'config-item config-item-clickable';
    el.innerHTML = `<span class="config-item-name">${esc(agent.name)}</span><span class="config-item-detail">${esc(agent.model)}</span>${scopeBadge(agent.scope)}`;
    el.addEventListener('click', () => openConfigFile(agent.filePath));
    return el;
  };

  const skillItem = (skill: Skill): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'config-item config-item-clickable';
    el.innerHTML = `<span class="config-item-name">${esc(skill.name)}</span><span class="config-item-detail">${esc(skill.description)}</span>${scopeBadge(skill.scope)}`;
    el.addEventListener('click', () => openConfigFile(skill.filePath));
    return el;
  };

  const commandItem = (cmd: Command): HTMLElement => {
    const el = document.createElement('div');
    el.className = 'config-item config-item-clickable';
    el.innerHTML = `<span class="config-item-name">/${esc(cmd.name)}</span><span class="config-item-detail">${esc(cmd.description)}</span>${scopeBadge(cmd.scope)}`;
    el.addEventListener('click', () => openConfigFile(cmd.filePath));
    return el;
  };

  const openConfigFile = (filePath: string) => {
    if (!filePath) return;
    appState.addFileReaderSession(project.id, filePath);
  };

  const renderSection = (title: string, items: HTMLElement[], count: number, onAdd?: () => void): HTMLElement => {
    const section = document.createElement('div');
    section.className = 'config-section project-tab-tools-section';

    const header = document.createElement('div');
    header.className = 'config-section-header';
    header.innerHTML = `${esc(title)}<span class="config-section-count">${count}</span>`;

    if (onAdd) {
      const addBtn = document.createElement('button');
      addBtn.className = 'config-section-add-btn';
      addBtn.textContent = '+';
      addBtn.title = `Add ${title.replace(/s$/, '')}`;
      addBtn.addEventListener('click', (e) => { e.stopPropagation(); onAdd(); });
      header.appendChild(addBtn);
    }

    const body = document.createElement('div');
    body.className = 'config-section-body';

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'config-empty';
      empty.textContent = 'None configured';
      body.appendChild(empty);
    } else {
      items.forEach(el => body.appendChild(el));
    }

    section.appendChild(header);
    section.appendChild(body);
    return section;
  };

  const destroyProviderSelect = () => {
    if (providerSelect) {
      providerSelect.destroy();
      providerSelect = null;
    }
  };

  const watchActiveProvider = () => {
    window.vibeyard.provider.watchProject(getActiveProviderId(project.id), project.path);
  };

  const refresh = async () => {
    if (destroyed) return;

    if (!getProviderAvailabilitySnapshot()) {
      await loadProviderAvailability();
    }
    if (destroyed) return;

    const available = getAvailableProviderMetas();
    const providerId = getActiveProviderId(project.id);

    let config: ProviderConfig;
    try {
      config = await window.vibeyard.provider.getConfig(providerId, project.path);
    } catch {
      destroyProviderSelect();
      root.innerHTML = '';
      return;
    }
    if (destroyed) return;

    destroyProviderSelect();
    root.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'project-tab-section-header';

    const title = document.createElement('span');
    title.className = 'project-tab-section-title';
    title.textContent = 'Provider Tools';
    header.appendChild(title);

    if (available.length > 1) {
      providerSelect = createCustomSelect(
        `config-provider-select-${project.id}`,
        available.map(p => ({ value: p.id, label: p.displayName })),
        providerId,
        (value) => {
          selectedProviderByProject.set(project.id, value as ProviderId);
          watchActiveProvider();
          void refresh();
        },
      );
      header.appendChild(providerSelect.element);
    }

    root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'project-tab-tools-body';

    body.appendChild(renderSection(
      'MCP Servers',
      config.mcpServers.map(mcpItem),
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

    root.appendChild(body);
  };

  const loading = document.createElement('div');
  loading.className = 'config-loading';
  loading.textContent = 'Loading...';
  root.appendChild(loading);

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
  };
}
