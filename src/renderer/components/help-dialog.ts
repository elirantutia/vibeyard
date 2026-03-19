import { closeModal } from './modal.js';
import { shortcutManager, displayKeys } from '../shortcuts.js';

const overlay = document.getElementById('modal-overlay')!;
const modal = document.getElementById('modal')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel')!;
const btnConfirm = document.getElementById('modal-confirm')!;

interface IndicatorRow {
  visual: () => HTMLElement;
  label: string;
  description: string;
}

function dot(color: string, animate?: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = 'help-dot';
  el.style.background = color;
  if (animate) el.style.animation = 'pulse 1.5s ease-in-out infinite';
  return el;
}

function badge(text: string, color: string, bgColor?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'help-badge';
  el.textContent = text;
  el.style.color = color;
  if (bgColor) el.style.background = bgColor;
  return el;
}

function mono(text: string, color?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'help-mono';
  el.textContent = text;
  if (color) el.style.color = color;
  return el;
}

function buildSection(title: string, rows: IndicatorRow[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'help-section';

  const header = document.createElement('div');
  header.className = 'help-section-header';
  header.textContent = title;
  section.appendChild(header);

  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'help-row';

    const visualEl = document.createElement('div');
    visualEl.className = 'help-visual';
    visualEl.appendChild(row.visual());

    const labelEl = document.createElement('div');
    labelEl.className = 'help-label';
    labelEl.textContent = row.label;

    const descEl = document.createElement('div');
    descEl.className = 'help-desc';
    descEl.textContent = row.description;

    rowEl.appendChild(visualEl);
    rowEl.appendChild(labelEl);
    rowEl.appendChild(descEl);
    section.appendChild(rowEl);
  }

  return section;
}

function buildShortcutSections(): HTMLElement[] {
  const sections: HTMLElement[] = [];
  const grouped = shortcutManager.getAll();

  for (const [category, shortcuts] of grouped) {
    // Collapse goto-session-1..9 into a single row
    const rows: IndicatorRow[] = [];
    let gotoHandled = false;

    for (const shortcut of shortcuts) {
      if (shortcut.id.startsWith('goto-session-')) {
        if (!gotoHandled) {
          gotoHandled = true;
          const first = displayKeys(shortcutManager.getKeys('goto-session-1'));
          const last = displayKeys(shortcutManager.getKeys('goto-session-9'));
          rows.push({
            visual: () => mono(`${first} - ${last}`),
            label: 'Go to Session N',
            description: 'Switch to session by number',
          });
        }
        continue;
      }

      rows.push({
        visual: () => mono(displayKeys(shortcut.resolvedKeys)),
        label: shortcut.label,
        description: '',
      });
    }

    sections.push(buildSection(`Shortcuts: ${category}`, rows));
  }

  return sections;
}

export function showHelpDialog(): void {
  titleEl.textContent = 'Help';
  bodyEl.innerHTML = '';
  modal.classList.add('modal-wide');
  btnCancel.style.display = 'none';

  const container = document.createElement('div');
  container.className = 'help-container';

  container.appendChild(buildSection('Tab Status Dot', [
    { visual: () => dot('#e94560', true), label: 'Working', description: 'Claude is actively generating a response' },
    { visual: () => dot('#f4b400'), label: 'Waiting', description: 'Claude is waiting for your input' },
    { visual: () => dot('#34a853'), label: 'Completed', description: 'Claude has finished the task' },
    { visual: () => dot('#e67e22', true), label: 'Permission', description: 'Claude needs permission to proceed' },
    { visual: () => dot('#606070'), label: 'Idle', description: 'Session is inactive (CLI exited)' },
  ]));

  container.appendChild(buildSection('Tab Badges', [
    { visual: () => badge('$1.23', '#606070'), label: 'Cost', description: 'Total API cost for this session' },
    { visual: () => badge('Session 1', '#e94560'), label: 'Unread', description: 'Background session needs attention' },
  ]));

  container.appendChild(buildSection('Status Bar', [
    { visual: () => mono('$1.23 \u00b7 5k in / 2k out'), label: 'Cost details', description: 'Detailed cost with token counts' },
    { visual: () => mono('[====------] 50%'), label: 'Context usage', description: 'How full the context window is' },
    { visual: () => mono('[=======---] 75%', '#f4b400'), label: 'Context warning', description: 'Context usage above 70%' },
    { visual: () => mono('[=========\u2010] 95%', '#e94560'), label: 'Context critical', description: 'Context usage above 90%' },
  ]));

  container.appendChild(buildSection('Git Status', [
    { visual: () => mono('\u2387 main', '#a0a0b0'), label: 'Branch', description: 'Current git branch' },
    { visual: () => mono('+3', '#34a853'), label: 'Staged', description: 'Files staged for commit' },
    { visual: () => mono('~2', '#f4b400'), label: 'Modified', description: 'Modified tracked files' },
    { visual: () => mono('?1', '#606070'), label: 'Untracked', description: 'New untracked files' },
    { visual: () => mono('!1', '#e94560'), label: 'Conflicted', description: 'Files with merge conflicts' },
    { visual: () => mono('\u21912 \u21933', '#606070'), label: 'Ahead/Behind', description: 'Commits ahead/behind remote' },
  ]));

  // Keyboard shortcuts sections
  for (const section of buildShortcutSections()) {
    container.appendChild(section);
  }

  bodyEl.appendChild(container);

  btnConfirm.textContent = 'Done';
  overlay.classList.remove('hidden');

  if ((overlay as any)._cleanup) {
    (overlay as any)._cleanup();
    (overlay as any)._cleanup = null;
  }

  const close = () => {
    closeModal();
    modal.classList.remove('modal-wide');
    btnCancel.style.display = '';
    btnConfirm.textContent = 'Create';
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  btnConfirm.addEventListener('click', close);
  btnCancel.addEventListener('click', close);
  overlay.addEventListener('keydown', handleKeydown);

  (overlay as any)._cleanup = () => {
    btnConfirm.removeEventListener('click', close);
    btnCancel.removeEventListener('click', close);
    overlay.removeEventListener('keydown', handleKeydown);
  };
}
