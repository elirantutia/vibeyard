import { appState } from '../state.js';
import { showMcpAddModal } from './mcp-add-modal.js';
import { createCustomSelect, type CustomSelectInstance } from './custom-select.js';
import {
  getAvailableProviderMetas,
  getProviderAvailabilitySnapshot,
  loadProviderAvailability,
} from '../provider-availability.js';
import type { ProviderConfig, ProviderId, McpServer, Agent, Skill, Command } from '../types.js';

const collapsed: Record<string, boolean> = {};
const selectedProviderByProject = new Map<string, ProviderId>();
let providerSelect: CustomSelectInstance | null = null;

function scopeBadge(scope: 'user' | 'project'): string {
  return `<span class="scope-badge ${scope}">${scope}</span>`;
}

function renderSection(id: string, title: string, items: HTMLElement[], count: number, onAdd?: () => void): HTMLElement {
  const section = document.createElement('div');
  section.className = 'config-section';

  const isCollapsed = collapsed[id] ?? true;

  const header = document.createElement('div');
  header.className = 'config-section-header';
  header.innerHTML = `<span class="config-section-toggle ${isCollapsed ? 'collapsed' : ''}">&#x25BC;</span>${title}<span class="config-section-count">${count}</span>`;

  if (onAdd) {
    const addBtn = document.createElement('button');
    addBtn.className = 'config-section-add-btn';
    addBtn.textContent = '+';
    addBtn.title = `Add ${title.replace(/s$/, '')}`;
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); onAdd(); });
    header.appendChild(addBtn);
  }

  const body = document.createElement('div');
  body.className = `config-section-body${isCollapsed ? ' hidden' : ''}`;

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'config-empty';
    empty.textContent = 'None configured';
    body.appendChild(empty);
  } else {
    items.forEach(el => body.appendChild(el));
  }

  header.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.config-section-add-btn')) return;
    collapsed[id] = !collapsed[id];
    const toggle = header.querySelector('.config-section-toggle')!;
    toggle.classList.toggle('collapsed');
    body.classList.toggle('hidden');
  });

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

function openConfigFile(filePath: string): void {
  const project = appState.activeProject;
  if (project && filePath) {
    appState.addFileReaderSession(project.id, filePath);
  }
}

function mcpItem(server: McpServer): HTMLElement {
  const el = document.createElement('div');
  el.className = 'config-item config-item-clickable';
  el.innerHTML = `<span class="config-item-name">${esc(server.name)}</span><span class="config-item-detail">${esc(server.status)}</span>${scopeBadge(server.scope)}`;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'config-item-remove-btn';
  removeBtn.textContent = '\u00d7';
  removeBtn.title = 'Remove server';
  removeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Remove MCP server "${server.name}"?`)) return;
    const projectPath = appState.activeProject?.path;
    await window.vibeyard.mcp.removeServer(server.name, server.filePath, server.scope, projectPath);
    refresh();
  });
  el.appendChild(removeBtn);

  el.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('.config-item-remove-btn')) return;
    openConfigFile(server.filePath);
  });
  return el;
}

function agentItem(agent: Agent): HTMLElement {
  const el = document.createElement('div');
  el.className = 'config-item config-item-clickable';
  el.innerHTML = `<span class="config-item-name">${esc(agent.name)}</span><span class="config-item-detail">${esc(agent.model)}</span>${scopeBadge(agent.scope)}`;
  el.addEventListener('click', () => openConfigFile(agent.filePath));
  return el;
}

function skillItem(skill: Skill): HTMLElement {
  const el = document.createElement('div');
  el.className = 'config-item config-item-clickable';
  el.innerHTML = `<span class="config-item-name">${esc(skill.name)}</span><span class="config-item-detail">${esc(skill.description)}</span>${scopeBadge(skill.scope)}`;
  el.addEventListener('click', () => openConfigFile(skill.filePath));
  return el;
}

function commandItem(cmd: Command): HTMLElement {
  const el = document.createElement('div');
  el.className = 'config-item config-item-clickable';
  el.innerHTML = `<span class="config-item-name">/${esc(cmd.name)}</span><span class="config-item-detail">${esc(cmd.description)}</span>${scopeBadge(cmd.scope)}`;
  el.addEventListener('click', () => openConfigFile(cmd.filePath));
  return el;
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function applyVisibility(): void {
  const container = document.getElementById('config-sections');
  if (!container) return;
  const visible = appState.preferences.sidebarViews?.configSections ?? true;
  container.classList.toggle('hidden', !visible);
}

export function getActiveConfigProviderId(projectId: string): ProviderId {
  const available = getAvailableProviderMetas().map(p => p.id);
  const stored = selectedProviderByProject.get(projectId);
  if (stored && available.includes(stored)) return stored;
  if (available.length > 0) return available[0];
  return 'claude';
}

async function refresh(): Promise<void> {
  const container = document.getElementById('config-sections');
  if (!container) return;

  applyVisibility();

  const project = appState.activeProject;
  if (!project) {
    destroyProviderSelect();
    container.innerHTML = '';
    return;
  }

  // Only show loading indicator on first render (when container is empty)
  const isFirstLoad = container.children.length === 0;
  if (isFirstLoad) {
    container.innerHTML = '<div class="config-loading">Loading...</div>';
  }

  if (!getProviderAvailabilitySnapshot()) {
    await loadProviderAvailability();
  }

  const available = getAvailableProviderMetas();
  const providerId = getActiveConfigProviderId(project.id);

  let config: ProviderConfig;
  try {
    config = await window.vibeyard.provider.getConfig(providerId, project.path);
  } catch {
    destroyProviderSelect();
    container.innerHTML = '';
    return;
  }

  destroyProviderSelect();
  container.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'config-panel-header';

  const title = document.createElement('span');
  title.className = 'config-panel-title';
  title.textContent = 'Provider Tools';
  header.appendChild(title);

  if (available.length > 1) {
    providerSelect = createCustomSelect(
      'config-provider-select-input',
      available.map(p => ({ value: p.id, label: p.displayName })),
      providerId,
      (value) => {
        selectedProviderByProject.set(project.id, value as ProviderId);
        watchActiveProject();
        refresh();
      },
    );
    header.appendChild(providerSelect.element);
  }

  container.appendChild(header);

  container.appendChild(renderSection(
    'mcp',
    'MCP Servers',
    config.mcpServers.map(mcpItem),
    config.mcpServers.length,
    providerId === 'claude' ? () => showMcpAddModal(() => refresh()) : undefined,
  ));

  container.appendChild(renderSection(
    'agents',
    'Agents',
    config.agents.map(agentItem),
    config.agents.length,
  ));

  container.appendChild(renderSection(
    'skills',
    'Skills',
    config.skills.map(skillItem),
    config.skills.length,
  ));

  if (providerId !== 'codex' && providerId !== 'copilot') {
    container.appendChild(renderSection(
      'commands',
      'Commands',
      config.commands.map(commandItem),
      config.commands.length,
    ));
  }
}

function destroyProviderSelect(): void {
  if (providerSelect) {
    providerSelect.destroy();
    providerSelect = null;
  }
}

function watchActiveProject(): void {
  const project = appState.activeProject;
  if (project) {
    window.vibeyard.provider.watchProject(getActiveConfigProviderId(project.id), project.path);
  }
}

export function initConfigSections(): void {
  appState.on('project-changed', () => { watchActiveProject(); refresh(); });
  appState.on('state-loaded', () => { watchActiveProject(); refresh(); });
  appState.on('preferences-changed', () => applyVisibility());
  window.vibeyard.provider.onConfigChanged(() => refresh());
}
