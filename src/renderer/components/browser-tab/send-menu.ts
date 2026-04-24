import { appState, type SessionRecord, type ProjectRecord } from '../../state.js';
import { getTerminalInstance } from '../terminal-pane.js';
import type { BrowserTabInstance } from './types.js';

function isCliBacked(s: SessionRecord): boolean {
  return !s.type || s.type === 'claude';
}

// The row we highlight matches what the user sees as "active" in the tab bar
// and swarm layout: `activeSessionId` when it points at a CLI session. When
// the user is sending from the browser tab itself, `activeSessionId` is the
// browser tab, so fall back to the most recently active CLI in nav history.
function resolveHighlightSession(project: ProjectRecord): SessionRecord | null {
  const active = project.sessions.find((s) => s.id === project.activeSessionId);
  if (active && isCliBacked(active)) return active;
  return appState.getLastActiveCliSessionInProject(project.id);
}

export interface SendMenuActions {
  deliverTo: (session: SessionRecord) => void | Promise<void>;
  onNewSession: () => void | Promise<void>;
  onNewWithArgs: () => void;
}

type SessionStatus = 'running' | 'dormant' | 'exited';

function sessionStatus(sessionId: string): SessionStatus {
  const inst = getTerminalInstance(sessionId);
  if (!inst) return 'dormant';
  if (inst.exited) return 'exited';
  return inst.spawned ? 'running' : 'dormant';
}

function refreshHighlight(instance: BrowserTabInstance): void {
  const project = appState.activeProject;
  const highlight = project ? resolveHighlightSession(project) : null;
  const rows = instance.sendMenuEl.querySelectorAll<HTMLButtonElement>(
    '.send-menu-item[data-session-id]',
  );
  rows.forEach((row) => {
    row.classList.toggle(
      'send-menu-item-last-active',
      row.dataset['sessionId'] === highlight?.id,
    );
  });
}

function makeSessionItem(
  session: SessionRecord,
  isLastActive: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const status = sessionStatus(session.id);
  const btn = document.createElement('button');
  btn.className = 'send-menu-item';
  if (isLastActive) btn.classList.add('send-menu-item-last-active');
  btn.dataset['sessionId'] = session.id;
  btn.title = `${session.name} — ${status}`;

  const dot = document.createElement('span');
  dot.className = `send-menu-dot send-menu-dot-${status}`;

  const label = document.createElement('span');
  label.className = 'send-menu-label';
  label.textContent = session.name;

  btn.appendChild(dot);
  btn.appendChild(label);
  btn.addEventListener('click', onClick);
  return btn;
}

function makeActionItem(label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'send-menu-item send-menu-item-action';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

export function showSendMenu(
  instance: BrowserTabInstance,
  anchor: HTMLElement,
  actions: SendMenuActions,
): void {
  const menu = instance.sendMenuEl;
  menu.innerHTML = '';

  const project = appState.activeProject;
  const sessions = (project?.sessions ?? []).filter(isCliBacked);
  const highlight = project ? resolveHighlightSession(project) : null;

  for (const s of sessions) {
    menu.appendChild(
      makeSessionItem(s, s.id === highlight?.id, () => {
        dismissSendMenu(instance);
        void actions.deliverTo(s);
      }),
    );
  }

  if (sessions.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'send-menu-divider';
    menu.appendChild(divider);
  }

  menu.appendChild(
    makeActionItem('+ New session', () => {
      dismissSendMenu(instance);
      void actions.onNewSession();
    }),
  );
  menu.appendChild(
    makeActionItem('+ New session with custom args…', () => {
      dismissSendMenu(instance);
      actions.onNewWithArgs();
    }),
  );

  // Show before measuring so we can read the rendered size
  instance.sendMenuOverlay.style.display = 'block';

  const paneRect = instance.element.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();

  let left = anchorRect.right - paneRect.left - menuRect.width;
  let top = anchorRect.top - paneRect.top - menuRect.height - 6;

  if (left < 8) left = 8;
  if (top < 8) top = anchorRect.bottom - paneRect.top + 6;

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  // Keep the highlight in sync if the user switches sessions via tab bar or
  // sidebar while the menu is open.
  instance.sendMenuCleanup?.();
  instance.sendMenuCleanup = appState.on('session-changed', () => refreshHighlight(instance));
}

export function dismissSendMenu(instance: BrowserTabInstance): void {
  instance.sendMenuCleanup?.();
  instance.sendMenuCleanup = undefined;
  instance.sendMenuOverlay.style.display = 'none';
  instance.sendMenuEl.innerHTML = '';
}
