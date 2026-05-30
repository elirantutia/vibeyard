import { shortcutManager, displayKeys } from '../shortcuts.js';
import { createModalShell, createModalButton } from './modal-shell.js';
import { buildSection, dot, badge, mono, type IndicatorRow } from './help-shared.js';

let cleanupFn: (() => void) | null = null;

function buildShortcutSections(): HTMLElement[] {
  const sections: HTMLElement[] = [];
  const grouped = shortcutManager.getAll();

  for (const [category, shortcuts] of grouped) {
    const rows: IndicatorRow[] = [];
    let gotoHandled = false;

    for (const shortcut of shortcuts) {
      // Collapse goto-session-1..9 into a single "N" row to avoid 9 near-identical entries
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
  cleanupFn?.();
  cleanupFn = null;

  const { overlay, body, actions } = createModalShell({
    id: 'help-overlay',
    title: 'Help',
    wide: true,
  });
  body.innerHTML = '';
  actions.innerHTML = '';

  const confirmBtn = createModalButton('Done', true);
  confirmBtn.id = 'help-confirm';
  actions.appendChild(confirmBtn);

  const container = document.createElement('div');
  container.className = 'help-container';

  container.appendChild(buildSection('Tab Status Dot', [
    { visual: () => dot('var(--accent)', true), label: 'Working', description: 'Claude is actively generating a response' },
    { visual: () => dot('var(--status-waiting)'), label: 'Waiting', description: 'Claude is not actively working' },
    { visual: () => dot('var(--status-completed)'), label: 'Completed', description: 'Claude has finished the task' },
    { visual: () => dot('var(--status-input)', true), label: 'Input', description: 'Claude is waiting for user input' },
    { visual: () => dot('var(--text-muted)'), label: 'Idle', description: 'Session is inactive (CLI exited)' },
  ]));

  container.appendChild(buildSection('Tab Badges', [
    { visual: () => badge('Session 1', 'var(--accent)'), label: 'Unread', description: 'Background session needs attention' },
  ]));

  container.appendChild(buildSection('Status Bar', [
    { visual: () => mono('$1.23 · 5k in / 2k out'), label: 'Cost details', description: 'Detailed cost with token counts' },
    { visual: () => mono('[====------] 50%'), label: 'Context usage', description: 'How full the context window is' },
    { visual: () => mono('[=======---] 75%', '#f4b400'), label: 'Context warning', description: 'Context usage above 70%' },
    { visual: () => mono('[=========‐] 95%', '#e94560'), label: 'Context critical', description: 'Context usage above 90%' },
  ]));

  container.appendChild(buildSection('Git Status', [
    { visual: () => mono('⎇ main', '#a0a0b0'), label: 'Branch', description: 'Current git branch' },
    { visual: () => mono('+3', '#34a853'), label: 'Staged', description: 'Files staged for commit' },
    { visual: () => mono('~2', '#f4b400'), label: 'Modified', description: 'Modified tracked files' },
    { visual: () => mono('?1', '#606070'), label: 'Untracked', description: 'New untracked files' },
    { visual: () => mono('!1', '#e94560'), label: 'Conflicted', description: 'Files with merge conflicts' },
    { visual: () => mono('↑2 ↓3', '#606070'), label: 'Ahead/Behind', description: 'Commits ahead/behind remote' },
  ]));

  for (const section of buildShortcutSections()) {
    container.appendChild(section);
  }

  body.appendChild(container);
  overlay.style.display = '';

  const close = () => {
    overlay.style.display = 'none';
    cleanupFn?.();
    cleanupFn = null;
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  confirmBtn.addEventListener('click', close);
  document.addEventListener('keydown', handleKeydown);

  cleanupFn = () => {
    confirmBtn.removeEventListener('click', close);
    document.removeEventListener('keydown', handleKeydown);
  };
}
