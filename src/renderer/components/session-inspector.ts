import { appState } from '../state.js';
import {
  onChange as onInspectorChange,
  clearSession,
} from '../session-inspector-state.js';
import { fitAllVisible } from './terminal-pane.js';
import { inspectorState } from './session-inspector-state-ui.js';
import { resetUIState, canInspectSession } from './session-inspector-utils.js';
import { renderTimeline } from './session-inspector-timeline.js';
import { renderCosts, renderTools, renderContext } from './session-inspector-views.js';

export function isInspectorOpen(): boolean {
  return inspectorState.inspectorPanel !== null && inspectorState.inspectedSessionId !== null;
}

export function getInspectedSessionId(): string | null {
  return inspectorState.inspectedSessionId;
}

export function openInspector(sessionId: string): void {
  const session = appState.activeProject?.sessions.find(s => s.id === sessionId);
  if (!session || !canInspectSession(session)) return;

  if (inspectorState.inspectorPanel && inspectorState.inspectedSessionId === sessionId) {
    closeInspector();
    return;
  }

  if (inspectorState.inspectedSessionId !== sessionId) resetUIState();
  inspectorState.inspectedSessionId = sessionId;

  if (!inspectorState.inspectorPanel) {
    inspectorState.inspectorPanel = createPanel();
    const container = document.getElementById('terminal-container')!;
    container.appendChild(inspectorState.inspectorPanel);
    container.classList.add('inspector-open');
    // Dynamic import to avoid circular dependency (split-layout imports from session-inspector)
    import('./split-layout.js').then(m => m.renderLayout());
  }

  renderActiveTab();
}

export function closeInspector(): void {
  if (!inspectorState.inspectorPanel) return;

  if (inspectorState.updateTimer) {
    clearTimeout(inspectorState.updateTimer);
    inspectorState.updateTimer = null;
  }

  const container = document.getElementById('terminal-container')!;
  container.classList.remove('inspector-open');
  inspectorState.inspectorPanel.remove();
  inspectorState.inspectorPanel = null;
  inspectorState.inspectedSessionId = null;

  // Dynamic import to avoid circular dependency (split-layout imports from session-inspector)
  import('./split-layout.js').then(m => m.renderLayout());
}

export function toggleInspector(): void {
  const project = appState.activeProject;
  if (!project?.activeSessionId) return;
  const session = project.sessions.find(s => s.id === project.activeSessionId);
  if (!session || !canInspectSession(session)) return;

  if (isInspectorOpen()) {
    closeInspector();
  } else {
    openInspector(project.activeSessionId);
  }
}

export function initSessionInspector(): void {
  // Auto-follow active session
  appState.on('session-changed', () => {
    const project = appState.activeProject;
    const activeSession = project?.activeSessionId
      ? project.sessions.find(s => s.id === project.activeSessionId)
      : undefined;

    if (!isInspectorOpen()) {
      if (inspectorState.reopenOnNextSession && project?.activeSessionId && activeSession && canInspectSession(activeSession)) {
        resetUIState();
        inspectorState.reopenOnNextSession = false;
        requestAnimationFrame(() => openInspector(project.activeSessionId!));
      }
      return;
    }

    if (project?.activeSessionId && project.activeSessionId !== inspectorState.inspectedSessionId) {
      if (activeSession && canInspectSession(activeSession)) {
        resetUIState();
        inspectorState.inspectedSessionId = project.activeSessionId;
        renderActiveTab();
      } else {
        inspectorState.reopenOnNextSession = true;
        closeInspector();
      }
    }
  });

  // Reset reopen flag when switching projects
  appState.on('project-changed', () => {
    inspectorState.reopenOnNextSession = false;
  });

  // Clear inspector events when /clear resets the CLI session
  appState.on('cli-session-cleared', (data) => {
    const d = data as { sessionId?: string } | undefined;
    if (!d?.sessionId) return;
    clearSession(d.sessionId);
    if (isInspectorOpen() && d.sessionId === inspectorState.inspectedSessionId) {
      renderActiveTab();
    }
  });

  // Clean up inspector state and close panel when session is removed
  appState.on('session-removed', (data) => {
    const d = data as { sessionId?: string } | undefined;
    if (!d?.sessionId) return;
    clearSession(d.sessionId);
    if (isInspectorOpen() && d.sessionId === inspectorState.inspectedSessionId) {
      inspectorState.reopenOnNextSession = true;
      closeInspector();
    }
  });

  // Re-open inspector when a new session is added after a clear/removal
  appState.on('session-added', (data) => {
    if (!inspectorState.reopenOnNextSession) return;
    const d = data as { session?: { id: string; type?: string } } | undefined;
    const session = d?.session ? appState.activeProject?.sessions.find(s => s.id === d.session!.id) : undefined;
    if (session && canInspectSession(session)) {
      inspectorState.reopenOnNextSession = false;
      requestAnimationFrame(() => openInspector(d.session!.id));
    }
  });

  // Update inspector on new events (debounced)
  onInspectorChange((sessionId) => {
    if (sessionId !== inspectorState.inspectedSessionId) return;
    if (inspectorState.updateTimer) clearTimeout(inspectorState.updateTimer);
    inspectorState.updateTimer = setTimeout(() => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed && inspectorState.inspectorPanel?.contains(sel.anchorNode)) {
        return; // don't destroy DOM while user is selecting text
      }
      renderActiveTab();
    }, 200);
  });

}

function createPanel(): HTMLElement {
  const panel = document.createElement('div');
  panel.id = 'session-inspector';

  // Resize handle
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'inspector-resize-handle';
  resizeHandle.addEventListener('mousedown', startResize);
  panel.appendChild(resizeHandle);

  // Header
  const header = document.createElement('div');
  header.className = 'inspector-header';

  const title = document.createElement('div');
  title.className = 'inspector-title';
  title.textContent = 'Inspector';
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'inspector-close';
  closeBtn.textContent = '\u00d7';
  closeBtn.addEventListener('click', closeInspector);
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Tabs
  const tabBar = document.createElement('div');
  tabBar.className = 'inspector-tabs';
  const tabs: { id: typeof inspectorState.activeTab; label: string }[] = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'costs', label: 'Costs' },
    { id: 'tools', label: 'Tools' },
    { id: 'context', label: 'Context' },
  ];
  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.className = 'inspector-tab' + (tab.id === inspectorState.activeTab ? ' active' : '');
    btn.textContent = tab.label;
    btn.dataset.tab = tab.id;
    btn.addEventListener('click', () => {
      inspectorState.activeTab = tab.id;
      tabBar.querySelectorAll('.inspector-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      renderActiveTab();
    });
    tabBar.appendChild(btn);
  }
  panel.appendChild(tabBar);

  const scrollToggle = document.createElement('button');
  scrollToggle.className = 'inspector-autoscroll-toggle active';
  scrollToggle.textContent = 'Auto-scroll';
  scrollToggle.title = 'Toggle auto-scroll to bottom';
  scrollToggle.addEventListener('click', () => {
    inspectorState.autoScroll = !inspectorState.autoScroll;
    scrollToggle.classList.toggle('active', inspectorState.autoScroll);
    if (inspectorState.autoScroll) {
      const content = panel.querySelector('.inspector-content') as HTMLElement;
      if (content) content.scrollTop = content.scrollHeight;
    }
  });
  panel.appendChild(scrollToggle);

  // Content area
  const content = document.createElement('div');
  content.className = 'inspector-content';

  content.addEventListener('scroll', () => {
    if (inspectorState.activeTab !== 'timeline' || inspectorState.programmaticScroll) return;
    const atBottom = content.scrollHeight - content.scrollTop - content.clientHeight < 30;
    // Only disable auto-scroll when user scrolls away from bottom;
    // re-enabling should only happen via the toggle button
    if (inspectorState.autoScroll && !atBottom) {
      inspectorState.autoScroll = false;
      scrollToggle.classList.toggle('active', false);
    }
  });

  panel.appendChild(content);

  return panel;
}

function renderActiveTab(): void {
  if (!inspectorState.inspectorPanel || !inspectorState.inspectedSessionId) return;
  const content = inspectorState.inspectorPanel.querySelector('.inspector-content') as HTMLElement;
  if (!content) return;

  const toggle = inspectorState.inspectorPanel.querySelector('.inspector-autoscroll-toggle') as HTMLElement;
  if (toggle) toggle.style.display = inspectorState.activeTab === 'timeline' ? '' : 'none';

  content.innerHTML = '';

  switch (inspectorState.activeTab) {
    case 'timeline': renderTimeline(content); break;
    case 'costs': renderCosts(content); break;
    case 'tools': renderTools(content); break;
    case 'context': renderContext(content); break;
  }
}

function startResize(e: MouseEvent): void {
  e.preventDefault();
  inspectorState.resizing = true;
  const startX = e.clientX;
  const container = document.getElementById('terminal-container')!;
  const startWidth = inspectorState.inspectorPanel?.offsetWidth ?? 350;

  const onMouseMove = (e: MouseEvent) => {
    if (!inspectorState.resizing) return;
    const diff = startX - e.clientX;
    const newWidth = Math.min(Math.max(startWidth + diff, 250), 800);
    container.style.setProperty('--inspector-width', `${newWidth}px`);
  };

  const onMouseUp = () => {
    inspectorState.resizing = false;
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    requestAnimationFrame(() => fitAllVisible());
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}
