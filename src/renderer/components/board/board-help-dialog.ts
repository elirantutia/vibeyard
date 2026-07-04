import { createModalShell, createModalButton } from '../modal-shell.js';
import { pushModal } from '../modal-manager.js';
import { buildSection, badge, mono } from '../help-shared.js';
import { createDefaultBoard } from '../../state.js';
import { t } from '../../i18n.js';
import type { ColumnBehavior } from '../../../shared/types.js';

let cleanupFn: (() => void) | null = null;

function behaviorDescription(behavior: ColumnBehavior): string {
  switch (behavior) {
    case 'inbox': return t('board.help.inboxDesc');
    case 'none': return t('board.help.noneDesc');
    case 'active': return t('board.help.activeDesc');
    case 'terminal': return t('board.help.terminalDesc');
  }
}

function buildDefaultColumnsSection(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'help-section';

  const header = document.createElement('div');
  header.className = 'help-section-header';
  header.textContent = t('board.help.defaultColumnsHeader');
  section.appendChild(header);

  for (const col of createDefaultBoard().columns) {
    const rowEl = document.createElement('div');
    rowEl.className = 'help-row';

    const visualEl = document.createElement('div');
    visualEl.className = 'help-visual';
    visualEl.appendChild(badge(col.title));

    const descEl = document.createElement('div');
    descEl.className = 'help-desc';
    descEl.textContent = behaviorDescription(col.behavior);

    rowEl.appendChild(visualEl);
    rowEl.appendChild(descEl);
    section.appendChild(rowEl);
  }

  return section;
}

export function showBoardHelpDialog(): void {
  cleanupFn?.();
  cleanupFn = null;

  const { overlay, body, actions } = createModalShell({
    id: 'board-help-overlay',
    title: t('board.help.title'),
    wide: true,
  });
  body.innerHTML = '';
  actions.innerHTML = '';

  const confirmBtn = createModalButton(t('board.help.doneButton'), true);
  confirmBtn.id = 'board-help-confirm';
  actions.appendChild(confirmBtn);

  const container = document.createElement('div');
  container.className = 'help-container';

  container.appendChild(buildDefaultColumnsSection());

  container.appendChild(buildSection(t('board.help.columnMgmtHeader'), [
    { visual: () => mono(t('board.help.columnAddSample')), label: t('board.help.columnAddLabel'), description: t('board.help.columnAddDesc') },
    { visual: () => mono(t('board.help.columnRenameSample')), label: t('board.help.columnRenameLabel'), description: t('board.help.columnRenameDesc') },
    { visual: () => mono(t('board.help.columnDeleteSample')), label: t('board.help.columnDeleteLabel'), description: t('board.help.columnDeleteDesc') },
  ]));

  container.appendChild(buildSection(t('board.help.cardActionsHeader'), [
    { visual: () => mono(t('board.help.cardRunSample')), label: t('board.help.cardRunLabel'), description: t('board.help.cardRunDesc') },
    { visual: () => mono(t('board.help.cardResumeSample')), label: t('board.help.cardResumeLabel'), description: t('board.help.cardResumeDesc') },
    { visual: () => mono(t('board.help.cardFocusSample')), label: t('board.help.cardFocusLabel'), description: t('board.help.cardFocusDesc') },
    { visual: () => mono(t('board.help.cardEditSample')), label: t('board.help.cardEditLabel'), description: t('board.help.cardEditDesc') },
    { visual: () => mono(t('board.help.cardDeleteSample')), label: t('board.help.cardDeleteLabel'), description: t('board.help.cardDeleteDesc') },
    { visual: () => badge(t('board.help.cardPlanSample')), label: t('board.help.cardPlanLabel'), description: t('board.help.cardPlanDesc') },
  ]));

  container.appendChild(buildSection(t('board.help.tagsSearchHeader'), [
    { visual: () => mono(t('board.help.tagsSearchSample')), label: t('board.help.tagsSearchLabel'), description: t('board.help.tagsSearchDesc') },
    { visual: () => badge(t('board.help.tagsTagSample')), label: t('board.help.tagsTagLabel'), description: t('board.help.tagsTagDesc') },
    { visual: () => mono(t('board.help.tagsAddSample')), label: t('board.help.tagsAddLabel'), description: t('board.help.tagsAddDesc') },
  ]));

  container.appendChild(buildSection(t('board.help.dragDropHeader'), [
    { visual: () => mono(t('board.help.dragSample')), label: t('board.help.dragLabel'), description: t('board.help.dragDesc') },
    { visual: () => mono(t('board.help.reorderSample')), label: t('board.help.reorderLabel'), description: t('board.help.reorderDesc') },
  ]));

  body.appendChild(container);
  overlay.style.display = '';

  const close = () => {
    overlay.style.display = 'none';
    cleanupFn?.();
    cleanupFn = null;
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      close();
    }
  };

  const unregisterEsc = pushModal({ onEscape: close });
  confirmBtn.addEventListener('click', close);
  document.addEventListener('keydown', handleKeydown);

  cleanupFn = () => {
    unregisterEsc();
    confirmBtn.removeEventListener('click', close);
    document.removeEventListener('keydown', handleKeydown);
  };
}
