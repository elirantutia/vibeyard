import { instances, type TeamInstance } from './instance.js';
import { renderTeam, hideTeamView } from './team-view.js';

export function createTeamPane(sessionId: string, projectId: string): void {
  if (instances.has(sessionId)) return;

  const el = document.createElement('div');
  el.className = 'team-pane hidden';
  el.dataset['sessionId'] = sessionId;

  const instance: TeamInstance = {
    sessionId,
    projectId,
    element: el,
    destroy() {
      el.remove();
    },
  };
  instances.set(sessionId, instance);
}

export function attachTeamToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function showTeamPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  instance.element.classList.toggle('split', isSplit);
  renderTeam(instance.element);
}

export function hideAllTeamPanes(): void {
  for (const instance of instances.values()) {
    instance.element.classList.add('hidden');
  }
  hideTeamView();
}

export function destroyTeamPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instances.delete(sessionId);
  instance.destroy();
}

export { getTeamInstance } from './instance.js';
