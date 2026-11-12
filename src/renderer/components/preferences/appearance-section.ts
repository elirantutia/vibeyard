import { appState } from '../../state.js';
import { createCustomSelect, type CustomSelectInstance } from '../custom-select.js';
import { applyZoom, getZoomFactor, ZOOM_STEPS } from '../../zoom.js';
import { t } from '../../i18n.js';
import type { PreferencesContext, SectionController } from './section.js';
import { sectionDesc, subheading, toggleRow } from './shared.js';
import type { Preferences } from '../../../shared/types.js';
import { DEFAULT_ACTIVE_SESSION_STATUSES } from '../active-sessions-panel.js';

type SidebarViews = { gitPanel: boolean; sessionHistory: boolean; discussions: boolean; fileTree: boolean; activeSessions: boolean };
type ActiveStatuses = NonNullable<Preferences['activeSessionStatuses']>;

export function createAppearanceSection(ctx: PreferencesContext): SectionController {
  let themeSelect: CustomSelectInstance | null = null;
  let zoomSelect: CustomSelectInstance | null = null;
  let zoomPrefUnsub: (() => void) | null = null;
  let sidebarCheckboxes: Record<keyof SidebarViews, HTMLInputElement> | null = null;
  let statusCheckboxes: Record<keyof ActiveStatuses, HTMLInputElement> | null = null;
  let boardCardMetricsCheckbox: HTMLInputElement | null = null;
  let bidiTextCheckbox: HTMLInputElement | null = null;

  function unsubZoom() {
    zoomPrefUnsub?.();
    zoomPrefUnsub = null;
  }

  return {
    render(container) {
      if (themeSelect) themeSelect.destroy();
      if (zoomSelect) zoomSelect.destroy();

      const themeRow = document.createElement('div');
      themeRow.className = 'modal-toggle-field';
      const themeLabel = document.createElement('label');
      themeLabel.textContent = t('appearance.theme');
      themeSelect = createCustomSelect(
        'pref-theme',
        [{ value: 'dark', label: t('appearance.themeDark') }, { value: 'light', label: t('appearance.themeLight') }],
        ctx.originalTheme,
        (value) => { document.documentElement.dataset.theme = value; },
      );
      themeRow.appendChild(themeLabel);
      themeRow.appendChild(themeSelect.element);
      container.appendChild(themeRow);

      const zoomRow = document.createElement('div');
      zoomRow.className = 'modal-toggle-field';
      const zoomLabel = document.createElement('label');
      zoomLabel.textContent = t('appearance.zoom');
      const zoomOptions = ZOOM_STEPS.map((v) => ({ value: String(v), label: `${Math.round(v * 100)}%` }));
      zoomSelect = createCustomSelect('pref-zoom', zoomOptions, String(getZoomFactor()), (value) => {
        const n = parseFloat(value);
        if (!Number.isNaN(n)) applyZoom(n);
      });
      zoomRow.appendChild(zoomLabel);
      zoomRow.appendChild(zoomSelect.element);
      container.appendChild(zoomRow);

      unsubZoom();
      zoomPrefUnsub = appState.on('preferences-changed', () => {
        zoomSelect?.setValue(String(getZoomFactor()));
      });

      container.appendChild(subheading(t('appearance.terminal')));

      const bidiText = toggleRow('pref-bidi-text', t('appearance.bidiText'), appState.preferences.bidiTextEnabled ?? false);
      bidiTextCheckbox = bidiText.checkbox;
      container.appendChild(bidiText.row);

      container.appendChild(sectionDesc(t('appearance.bidiTextDesc')));

      container.appendChild(subheading(t('appearance.sidebarViews')));

      const views = appState.preferences.sidebarViews ?? { gitPanel: true, sessionHistory: true, discussions: true, fileTree: true, activeSessions: true };
      const toggles: { key: keyof SidebarViews; label: string }[] = [
        { key: 'fileTree', label: t('appearance.fileTree') },
        { key: 'gitPanel', label: t('appearance.gitPanel') },
        { key: 'sessionHistory', label: t('appearance.sessionHistory') },
        { key: 'discussions', label: t('appearance.discussions') },
        { key: 'activeSessions', label: t('appearance.activeSessions') },
      ];

      const checkboxes = {} as Record<keyof SidebarViews, HTMLInputElement>;
      for (const toggle of toggles) {
        const { row, checkbox } = toggleRow(`pref-sidebar-${toggle.key}`, toggle.label, views[toggle.key] ?? true);
        container.appendChild(row);
        checkboxes[toggle.key] = checkbox;
      }
      sidebarCheckboxes = checkboxes;

      container.appendChild(subheading(t('appearance.activeSessionStatuses')));

      const statuses = appState.preferences.activeSessionStatuses ?? DEFAULT_ACTIVE_SESSION_STATUSES;
      const statusToggles: { key: keyof ActiveStatuses; label: string }[] = [
        { key: 'working', label: t('help.status.working') },
        { key: 'input', label: t('help.status.input') },
        { key: 'waiting', label: t('help.status.waiting') },
        { key: 'completed', label: t('help.status.completed') },
      ];
      const statusBoxes = {} as Record<keyof ActiveStatuses, HTMLInputElement>;
      for (const toggle of statusToggles) {
        const { row, checkbox } = toggleRow(`pref-active-status-${toggle.key}`, toggle.label, statuses[toggle.key] ?? DEFAULT_ACTIVE_SESSION_STATUSES[toggle.key]);
        container.appendChild(row);
        statusBoxes[toggle.key] = checkbox;
      }
      statusCheckboxes = statusBoxes;

      container.appendChild(subheading(t('appearance.board')));

      const boardMetrics = toggleRow('pref-board-card-metrics', t('appearance.showMetricsOnCards'), appState.preferences.boardCardMetrics ?? true);
      boardCardMetricsCheckbox = boardMetrics.checkbox;
      container.appendChild(boardMetrics.row);
    },

    save() {
      if (themeSelect) appState.setPreference('theme', themeSelect.getValue() as 'dark' | 'light');
      if (sidebarCheckboxes) {
        appState.setPreference('sidebarViews', {
          gitPanel: sidebarCheckboxes.gitPanel.checked,
          sessionHistory: sidebarCheckboxes.sessionHistory.checked,
          discussions: sidebarCheckboxes.discussions.checked,
          fileTree: sidebarCheckboxes.fileTree.checked,
          activeSessions: sidebarCheckboxes.activeSessions.checked,
        });
      }
      if (statusCheckboxes) {
        appState.setPreference('activeSessionStatuses', {
          working: statusCheckboxes.working.checked,
          waiting: statusCheckboxes.waiting.checked,
          input: statusCheckboxes.input.checked,
          completed: statusCheckboxes.completed.checked,
        });
      }
      if (bidiTextCheckbox && bidiTextCheckbox.checked !== (appState.preferences.bidiTextEnabled ?? false)) {
        appState.setPreference('bidiTextEnabled', bidiTextCheckbox.checked);
      }
      if (boardCardMetricsCheckbox && boardCardMetricsCheckbox.checked !== (appState.preferences.boardCardMetrics ?? true)) {
        appState.setPreference('boardCardMetrics', boardCardMetricsCheckbox.checked);
      }
    },

    onLeave() {
      unsubZoom();
    },

    destroy() {
      unsubZoom();
      if (themeSelect) themeSelect.destroy();
      if (zoomSelect) zoomSelect.destroy();
      themeSelect = null;
      zoomSelect = null;
      bidiTextCheckbox = null;
    },
  };
}
