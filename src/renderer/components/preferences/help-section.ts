import { buildSection, dot, badge, mono } from '../help-shared.js';
import type { SectionController } from './section.js';

export function createHelpSection(): SectionController {
  return {
    render(container) {
      const helpContainer = document.createElement('div');
      helpContainer.className = 'help-container';

      helpContainer.appendChild(buildSection('Tab Status Dot', [
        { visual: () => dot('var(--accent)', true), label: 'Working', description: 'Claude is actively generating a response' },
        { visual: () => dot('var(--status-waiting)'), label: 'Waiting', description: 'Claude is not actively working' },
        { visual: () => dot('var(--status-completed)'), label: 'Completed', description: 'Claude has finished the task' },
        { visual: () => dot('var(--status-input)', true), label: 'Input', description: 'Claude is waiting for user input' },
        { visual: () => dot('var(--text-muted)'), label: 'Idle', description: 'Session is inactive (CLI exited)' },
      ]));

      helpContainer.appendChild(buildSection('Tab Badges', [
        { visual: () => badge('Session 1', 'var(--accent)'), label: 'Unread', description: 'Background session needs attention' },
      ]));

      helpContainer.appendChild(buildSection('Status Bar', [
        { visual: () => mono('$1.23 · 5k in / 2k out'), label: 'Cost details', description: 'Detailed cost with token counts' },
        { visual: () => mono('[====------] 50%'), label: 'Context usage', description: 'How full the context window is' },
        { visual: () => mono('[=======---] 75%', '#f4b400'), label: 'Context warning', description: 'Context usage above 70%' },
        { visual: () => mono('[=========‐] 95%', '#e94560'), label: 'Context critical', description: 'Context usage above 90%' },
      ]));

      helpContainer.appendChild(buildSection('Git Status', [
        { visual: () => mono('⎇ main', '#a0a0b0'), label: 'Branch', description: 'Current git branch' },
        { visual: () => mono('+3', '#34a853'), label: 'Staged', description: 'Files staged for commit' },
        { visual: () => mono('~2', '#f4b400'), label: 'Modified', description: 'Modified tracked files' },
        { visual: () => mono('?1', '#606070'), label: 'Untracked', description: 'New untracked files' },
        { visual: () => mono('!1', '#e94560'), label: 'Conflicted', description: 'Files with merge conflicts' },
        { visual: () => mono('↑2 ↓3', '#606070'), label: 'Ahead/Behind', description: 'Commits ahead/behind remote' },
      ]));

      container.appendChild(helpContainer);
    },
  };
}
