import { appState } from '../../state.js';
import { instances, type ProjectTabInstance } from './instance.js';
import { createProjectTabGrid, type ProjectTabGrid } from './grid.js';
import { showWidgetPicker } from './widgets/widget-picker-modal.js';
import { showGithubSettings } from './widgets/github-settings-modal.js';
import { showSessionsSettings } from './widgets/sessions-settings-modal.js';
import { showTopFilesSettings } from './widgets/top-files-settings-modal.js';
import type { OverviewLayout, OverviewWidget } from '../../../shared/types.js';

function defaultLayout(): OverviewLayout {
  return {
    gridVersion: 1,
    widgets: [
      { id: crypto.randomUUID(), type: 'readiness', x: 0, y: 0, w: 8, h: 8 },
      { id: crypto.randomUUID(), type: 'provider-tools', x: 8, y: 0, w: 4, h: 8 },
      { id: crypto.randomUUID(), type: 'kanban', x: 0, y: 8, w: 6, h: 8 },
      { id: crypto.randomUUID(), type: 'team', x: 6, y: 8, w: 6, h: 8 },
    ],
  };
}

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
      destroy() { el.remove(); },
    };
    instances.set(sessionId, instance);
    return;
  }

  // Lazy-create the default layout — no migration code per the project rule.
  if (!project.overviewLayout || project.overviewLayout.widgets.length === 0) {
    appState.setProjectOverviewLayout(projectId, defaultLayout());
  }
  const layout = project.overviewLayout!;

  const toolbar = document.createElement('div');
  toolbar.className = 'project-tab-toolbar';

  const addBtn = document.createElement('button');
  addBtn.className = 'btn-secondary btn-sm project-tab-toolbar-btn';
  addBtn.textContent = '+ Add Widget';
  toolbar.appendChild(addBtn);

  const editBtn = document.createElement('button');
  editBtn.className = 'btn-secondary btn-sm project-tab-toolbar-btn';
  editBtn.textContent = 'Edit layout';
  editBtn.title = 'Toggle drag and resize';
  toolbar.appendChild(editBtn);

  // Scroll lives on this wrapper, not on .project-tab-grid-root. Gridstack's
  // resize math assumes the items' direct parent is not internally scrolled —
  // see dd-resizable.js _applyChange, which writes style.top as
  // (itemViewportY - parentViewportY). If the parent itself scrolls, that diff
  // is off by scrollTop and the tile jumps on the first mousemove of a resize.
  const gridScroll = document.createElement('div');
  gridScroll.className = 'project-tab-grid-scroll';

  const gridRoot = document.createElement('div');
  gridRoot.className = 'project-tab-grid-root';
  gridScroll.appendChild(gridRoot);

  el.appendChild(toolbar);
  el.appendChild(gridScroll);

  let grid: ProjectTabGrid | null = null;

  const handleOpenSettings = (widget: OverviewWidget) => {
    if (widget.type === 'github-prs' || widget.type === 'github-issues') {
      showGithubSettings(widget, (patch) => {
        grid?.updateWidgetConfig(widget.id, patch);
      });
    } else if (widget.type === 'sessions') {
      showSessionsSettings(widget, (patch) => {
        grid?.updateWidgetConfig(widget.id, patch);
      });
    } else if (widget.type === 'top-files-by-tokens') {
      showTopFilesSettings(widget, (patch) => {
        grid?.updateWidgetConfig(widget.id, patch);
      });
    }
  };

  const handleChange = (next: OverviewLayout) => {
    appState.setProjectOverviewLayout(projectId, next);
  };

  let editing = false;
  editBtn.addEventListener('click', () => {
    editing = !editing;
    grid?.setEditMode(editing);
    editBtn.classList.toggle('active', editing);
    editBtn.textContent = editing ? 'Done editing' : 'Edit layout';
    el.classList.toggle('editing', editing);
  });

  addBtn.addEventListener('click', () => {
    const fresh = appState.projects.find(p => p.id === projectId);
    const widgets = fresh?.overviewLayout?.widgets ?? [];
    showWidgetPicker(widgets, (type) => {
      grid?.addWidget(type);
    });
  });

  grid = createProjectTabGrid({
    projectId,
    rootEl: gridRoot,
    initialLayout: layout,
    onChange: handleChange,
    onOpenSettings: handleOpenSettings,
  });

  const instance: ProjectTabInstance = {
    sessionId,
    projectId,
    element: el,
    destroy() {
      grid?.destroy();
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
