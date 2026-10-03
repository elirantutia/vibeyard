import { buildSection, badge, mono, glyph } from '../help-shared.js';
import { STATUS_GLYPH } from '../../session-activity.js';
import { t } from '../../i18n.js';
import type { SectionController } from './section.js';

export function createHelpSection(): SectionController {
  return {
    render(container) {
      const helpContainer = document.createElement('div');
      helpContainer.className = 'help-container';

      helpContainer.appendChild(buildSection(t('help.tabStatusDot'), [
        { visual: () => glyph(STATUS_GLYPH.working, 'var(--accent)', true), label: t('help.status.working'), description: t('help.status.workingDesc') },
        { visual: () => glyph(STATUS_GLYPH.waiting, 'var(--status-waiting)'), label: t('help.status.waiting'), description: t('help.status.waitingDesc') },
        { visual: () => glyph(STATUS_GLYPH.completed, 'var(--status-completed)'), label: t('help.status.completed'), description: t('help.status.completedDesc') },
        { visual: () => glyph(STATUS_GLYPH.input, 'var(--status-input)', true), label: t('help.status.input'), description: t('help.status.inputDesc') },
        { visual: () => glyph(STATUS_GLYPH.idle, 'var(--text-muted)'), label: t('help.status.idle'), description: t('help.status.idleDesc') },
      ]));

      helpContainer.appendChild(buildSection(t('help.tabBadges'), [
        { visual: () => badge(t('help.tabBadgeSample'), 'var(--accent)'), label: t('help.tabBadgeUnreadLabel'), description: t('help.tabBadgeUnreadDesc') },
      ]));

      helpContainer.appendChild(buildSection(t('help.statusBar'), [
        { visual: () => mono(t('help.statusBarSample1')), label: t('help.statusBarCostLabel'), description: t('help.statusBarCostDesc') },
        { visual: () => mono(t('help.statusBarSample2')), label: t('help.statusBarCtxLabel'), description: t('help.statusBarCtxDesc') },
        { visual: () => mono(t('help.statusBarSample3'), '#f4b400'), label: t('help.statusBarWarnLabel'), description: t('help.statusBarWarnDesc') },
        { visual: () => mono(t('help.statusBarSample4'), '#e94560'), label: t('help.statusBarCritLabel'), description: t('help.statusBarCritDesc') },
      ]));

      helpContainer.appendChild(buildSection(t('help.gitStatus'), [
        { visual: () => mono(t('help.gitSampleBranch'), '#a0a0b0'), label: t('help.gitBranchLabel'), description: t('help.gitBranchDesc') },
        { visual: () => mono(t('help.gitSampleStaged'), '#34a853'), label: t('help.gitStagedLabel'), description: t('help.gitStagedDesc') },
        { visual: () => mono(t('help.gitSampleModified'), '#f4b400'), label: t('help.gitModifiedLabel'), description: t('help.gitModifiedDesc') },
        { visual: () => mono(t('help.gitSampleUntracked'), '#606070'), label: t('help.gitUntrackedLabel'), description: t('help.gitUntrackedDesc') },
        { visual: () => mono(t('help.gitSampleConflicted'), '#e94560'), label: t('help.gitConflictedLabel'), description: t('help.gitConflictedDesc') },
        { visual: () => mono(t('help.gitSampleAhead'), '#606070'), label: t('help.gitAheadLabel'), description: t('help.gitAheadDesc') },
      ]));

      container.appendChild(helpContainer);
    },
  };
}
