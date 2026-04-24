import { appState, type SessionRecord } from '../../state.js';
import { getTerminalInstance } from '../terminal-pane.js';
import type { BrowserTabInstance } from './types.js';

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

function makeSessionItem(session: SessionRecord, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'send-menu-item';
  btn.dataset['sessionId'] = session.id;
  btn.title = `${session.name} — ${sessionStatus(session.id)}`;

  const dot = document.createElement('span');
  dot.className = `send-menu-dot send-menu-dot-${sessionStatus(session.id)}`;

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
  const sessions = (project?.sessions ?? []).filter((s) => !s.type || s.type === 'claude');

  for (const s of sessions) {
    menu.appendChild(
      makeSessionItem(s, () => {
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

  // Focus the first item so keyboard users can Enter immediately
  const firstItem = menu.querySelector<HTMLButtonElement>('.send-menu-item');
  firstItem?.focus();
}

export function dismissSendMenu(instance: BrowserTabInstance): void {
  instance.sendMenuOverlay.style.display = 'none';
  instance.sendMenuEl.innerHTML = '';
}
