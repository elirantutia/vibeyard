import { appState } from '../../state.js';
import { createCustomSelect, type CustomSelectInstance } from '../custom-select.js';
import { applyZoom, getZoomFactor, ZOOM_STEPS } from '../../zoom.js';
import type { PreferencesContext, SectionController } from './section.js';
import { toggleRow } from './shared.js';

type SidebarViews = { gitPanel: boolean; sessionHistory: boolean; discussions: boolean; fileTree: boolean };

export function createAppearanceSection(ctx: PreferencesContext): SectionController {
  let themeSelect: CustomSelectInstance | null = null;
  let zoomSelect: CustomSelectInstance | null = null;
  let zoomPrefUnsub: (() => void) | null = null;
  let sidebarCheckboxes: Record<keyof SidebarViews, HTMLInputElement> | null = null;
  let boardCardMetricsCheckbox: HTMLInputElement | null = null;

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
      themeLabel.textContent = 'Theme';
      themeSelect = createCustomSelect(
        'pref-theme',
        [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
        ctx.originalTheme,
        (value) => { document.documentElement.dataset.theme = value; },
      );
      themeRow.appendChild(themeLabel);
      themeRow.appendChild(themeSelect.element);
      container.appendChild(themeRow);

      const zoomRow = document.createElement('div');
      zoomRow.className = 'modal-toggle-field';
      const zoomLabel = document.createElement('label');
      zoomLabel.textContent = 'Zoom';
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

      const sidebarHeading = document.createElement('div');
      sidebarHeading.className = 'preferences-subheading';
      sidebarHeading.textContent = 'Sidebar Views';
      container.appendChild(sidebarHeading);

      const views = appState.preferences.sidebarViews ?? { gitPanel: true, sessionHistory: true, discussions: true, fileTree: true };
      const toggles: { key: keyof SidebarViews; label: string }[] = [
        { key: 'fileTree', label: 'Project File Tree' },
        { key: 'gitPanel', label: 'Git Panel' },
        { key: 'sessionHistory', label: 'Session History' },
        { key: 'discussions', label: 'Discussions' },
      ];

      const checkboxes = {} as Record<keyof SidebarViews, HTMLInputElement>;
      for (const toggle of toggles) {
        const { row, checkbox } = toggleRow(`pref-sidebar-${toggle.key}`, toggle.label, views[toggle.key] ?? true);
        container.appendChild(row);
        checkboxes[toggle.key] = checkbox;
      }
      sidebarCheckboxes = checkboxes;

      const boardHeading = document.createElement('div');
      boardHeading.className = 'preferences-subheading';
      boardHeading.textContent = 'Board';
      container.appendChild(boardHeading);

      const boardMetrics = toggleRow('pref-board-card-metrics', 'Show metrics on cards', appState.preferences.boardCardMetrics ?? true);
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
        });
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
    },
  };
}
