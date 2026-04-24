import { appState } from '../../state.js';
import { esc } from '../../dom-utils.js';
import { instances, type ProjectTabInstance } from './instance.js';
import { createReadinessColumn } from './readiness-column.js';
import { createProviderToolsColumn } from './provider-tools-column.js';

export function createProjectTabPane(sessionId: string, projectId: string): void {
  if (instances.has(sessionId)) return;

  const project = appState.projects.find(p => p.id === projectId);

  const el = document.createElement('div');
  el.className = 'project-tab-pane hidden';
  el.dataset['sessionId'] = sessionId;

  if (!project) {
    const empty = document.createElement('div');
    empty.className = 'project-tab-empty';
    empty.textContent = 'Project unavailable';
    el.appendChild(empty);

    const instance: ProjectTabInstance = {
      sessionId,
      projectId,
      element: el,
      destroy() {
        el.remove();
      },
    };
    instances.set(sessionId, instance);
    return;
  }

  const header = document.createElement('div');
  header.className = 'project-tab-header';
  header.innerHTML = `
    <div class="project-tab-header-name">${esc(project.name)}</div>
    <div class="project-tab-header-path">${esc(project.path)}</div>
  `;
  el.appendChild(header);

  const columns = document.createElement('div');
  columns.className = 'project-tab-columns';

  const readiness = createReadinessColumn(project);
  const tools = createProviderToolsColumn(project);

  columns.appendChild(readiness.element);
  columns.appendChild(tools.element);
  el.appendChild(columns);

  const instance: ProjectTabInstance = {
    sessionId,
    projectId,
    element: el,
    destroy() {
      readiness.destroy();
      tools.destroy();
      el.remove();
    },
  };
  instances.set(sessionId, instance);
}

export function attachProjectTabToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function showProjectTabPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  instance.element.classList.toggle('split', isSplit);
}

export function hideAllProjectTabPanes(): void {
  for (const instance of instances.values()) {
    instance.element.classList.add('hidden');
  }
}

export function destroyProjectTabPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instances.delete(sessionId);
  instance.destroy();
}

export { getProjectTabInstance } from './instance.js';
