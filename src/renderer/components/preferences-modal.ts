import { appState } from '../state.js';
import { closeModal } from './modal.js';
import { shortcutManager, displayKeys, eventToAccelerator } from '../shortcuts.js';


const overlay = document.getElementById('modal-overlay')!;
const modal = document.getElementById('modal')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel')!;
const btnConfirm = document.getElementById('modal-confirm')!;

type Section = 'general' | 'sidebar' | 'shortcuts' | 'about';

export function showPreferencesModal(): void {
  titleEl.textContent = 'Preferences';
  bodyEl.innerHTML = '';
  modal.classList.add('modal-wide');

  // Build two-pane layout
  const layout = document.createElement('div');
  layout.className = 'preferences-layout';

  // Side menu
  const menu = document.createElement('div');
  menu.className = 'preferences-menu';

  const sections: { id: Section; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'sidebar', label: 'Sidebar' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'about', label: 'About' },
  ];

  const menuItems: Map<Section, HTMLDivElement> = new Map();
  for (const section of sections) {
    const item = document.createElement('div');
    item.className = 'preferences-menu-item';
    item.textContent = section.label;
    item.dataset.section = section.id;
    menu.appendChild(item);
    menuItems.set(section.id, item);
  }

  // Content area
  const content = document.createElement('div');
  content.className = 'preferences-content';

  layout.appendChild(menu);
  layout.appendChild(content);
  bodyEl.appendChild(layout);

  // Build section content
  let currentSection: Section = 'general';
  let soundCheckbox: HTMLInputElement | null = null;
  let historyCheckbox: HTMLInputElement | null = null;
  let insightsCheckbox: HTMLInputElement | null = null;
  let sidebarCheckboxes: { configSections: HTMLInputElement; gitPanel: HTMLInputElement; sessionHistory: HTMLInputElement; costFooter: HTMLInputElement; readinessSection: HTMLInputElement } | null = null;
  let activeRecorder: { cleanup: () => void } | null = null;

  function cleanupRecorder() {
    if (activeRecorder) {
      activeRecorder.cleanup();
      activeRecorder = null;
    }
  }

  function renderSection(section: Section) {
    cleanupRecorder();
    currentSection = section;
    content.innerHTML = '';

    // Update active menu item
    for (const [id, item] of menuItems) {
      item.classList.toggle('active', id === section);
    }

    if (section === 'general') {
      const row = document.createElement('div');
      row.className = 'modal-toggle-field';

      const label = document.createElement('label');
      label.htmlFor = 'pref-sound-on-waiting';
      label.textContent = 'Play sound when session finishes work';

      soundCheckbox = document.createElement('input');
      soundCheckbox.type = 'checkbox';
      soundCheckbox.id = 'pref-sound-on-waiting';
      soundCheckbox.checked = appState.preferences.soundOnSessionWaiting;

      row.appendChild(label);
      row.appendChild(soundCheckbox);
      content.appendChild(row);

      const historyRow = document.createElement('div');
      historyRow.className = 'modal-toggle-field';

      const historyLabel = document.createElement('label');
      historyLabel.htmlFor = 'pref-session-history';
      historyLabel.textContent = 'Record session history when sessions close';

      historyCheckbox = document.createElement('input');
      historyCheckbox.type = 'checkbox';
      historyCheckbox.id = 'pref-session-history';
      historyCheckbox.checked = appState.preferences.sessionHistoryEnabled;

      historyRow.appendChild(historyLabel);
      historyRow.appendChild(historyCheckbox);
      content.appendChild(historyRow);

      const insightsRow = document.createElement('div');
      insightsRow.className = 'modal-toggle-field';

      const insightsLabel = document.createElement('label');
      insightsLabel.htmlFor = 'pref-insights-enabled';
      insightsLabel.textContent = 'Show insight alerts';

      insightsCheckbox = document.createElement('input');
      insightsCheckbox.type = 'checkbox';
      insightsCheckbox.id = 'pref-insights-enabled';
      insightsCheckbox.checked = appState.preferences.insightsEnabled;

      insightsRow.appendChild(insightsLabel);
      insightsRow.appendChild(insightsCheckbox);
      content.appendChild(insightsRow);

    } else if (section === 'sidebar') {
      const views = appState.preferences.sidebarViews ?? { configSections: true, gitPanel: true, sessionHistory: true, costFooter: true, readinessSection: true };
      const toggles: { key: keyof typeof views; label: string }[] = [
        { key: 'configSections', label: 'Config Sections (MCP Servers, Agents, Skills, Commands)' },
        { key: 'readinessSection', label: 'AI Readiness' },
        { key: 'gitPanel', label: 'Git Panel' },
        { key: 'sessionHistory', label: 'Session History' },
        { key: 'costFooter', label: 'Cost Footer' },
      ];

      const checkboxes: Record<string, HTMLInputElement> = {};
      for (const toggle of toggles) {
        const row = document.createElement('div');
        row.className = 'modal-toggle-field';

        const label = document.createElement('label');
        label.htmlFor = `pref-sidebar-${toggle.key}`;
        label.textContent = toggle.label;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = `pref-sidebar-${toggle.key}`;
        cb.checked = views[toggle.key];

        row.appendChild(label);
        row.appendChild(cb);
        content.appendChild(row);
        checkboxes[toggle.key] = cb;
      }
      sidebarCheckboxes = checkboxes as typeof sidebarCheckboxes;

    } else if (section === 'shortcuts') {
      renderShortcutsSection(content);

    } else if (section === 'about') {
      const aboutDiv = document.createElement('div');
      aboutDiv.className = 'about-section';

      const appName = document.createElement('div');
      appName.className = 'about-app-name';
      appName.textContent = 'CCide';

      const versionLine = document.createElement('div');
      versionLine.className = 'about-version';
      versionLine.textContent = 'Version: loading...';

      const updateRow = document.createElement('div');
      updateRow.className = 'about-update-row';

      const updateBtn = document.createElement('button');
      updateBtn.className = 'about-update-btn';
      updateBtn.textContent = 'Check for Updates';

      const updateStatus = document.createElement('span');
      updateStatus.className = 'about-update-status';

      updateBtn.addEventListener('click', () => {
        updateBtn.disabled = true;
        updateStatus.textContent = 'Checking...';
        window.claudeIde.update.checkNow().then(() => {
          // If no update event fires within a few seconds, show "up to date"
          const timeout = setTimeout(() => {
            updateStatus.textContent = 'You\u2019re up to date.';
            updateBtn.disabled = false;
          }, 5000);
          const unsub = window.claudeIde.update.onAvailable((info) => {
            clearTimeout(timeout);
            updateStatus.textContent = `Update v${info.version} available — downloading...`;
            unsub();
          });
          const unsubErr = window.claudeIde.update.onError(() => {
            clearTimeout(timeout);
            updateStatus.textContent = 'Update check failed.';
            updateBtn.disabled = false;
            unsubErr();
          });
        }).catch(() => {
          updateStatus.textContent = 'Update check failed.';
          updateBtn.disabled = false;
        });
      });

      updateRow.appendChild(updateBtn);
      updateRow.appendChild(updateStatus);

      aboutDiv.appendChild(appName);
      aboutDiv.appendChild(versionLine);
      aboutDiv.appendChild(updateRow);
      content.appendChild(aboutDiv);

      window.claudeIde.app.getVersion().then((ver) => {
        versionLine.textContent = `Version: ${ver}`;
      });
    }
  }

  function renderShortcutsSection(container: HTMLElement) {
    const grouped = shortcutManager.getAll();

    for (const [category, shortcuts] of grouped) {
      const header = document.createElement('div');
      header.className = 'shortcut-category-header';
      header.textContent = category;
      container.appendChild(header);

      for (const shortcut of shortcuts) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';

        const label = document.createElement('div');
        label.className = 'shortcut-row-label';
        label.textContent = shortcut.label;

        const keyBtn = document.createElement('button');
        keyBtn.className = 'shortcut-key-btn';
        keyBtn.textContent = displayKeys(shortcut.resolvedKeys);

        const hasOverride = shortcutManager.hasOverride(shortcut.id);
        if (hasOverride) {
          keyBtn.classList.add('customized');
        }

        const resetBtn = document.createElement('button');
        resetBtn.className = 'shortcut-reset-btn';
        resetBtn.textContent = 'Reset';
        resetBtn.title = 'Reset to default';
        if (!hasOverride) {
          resetBtn.style.visibility = 'hidden';
        }

        // Click key button to start recording
        keyBtn.addEventListener('click', () => {
          cleanupRecorder();
          keyBtn.textContent = 'Press keys...';
          keyBtn.classList.add('recording');

          const onKeydown = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();

            const accelerator = eventToAccelerator(e);
            if (!accelerator) return; // Bare modifier press

            // Save the override
            shortcutManager.setOverride(shortcut.id, accelerator);
            cleanup();
            // Re-render to update display
            renderSection('shortcuts');
          };

          const onBlur = () => {
            cleanup();
            keyBtn.textContent = displayKeys(shortcutManager.getKeys(shortcut.id));
            keyBtn.classList.remove('recording');
          };

          const cleanup = () => {
            document.removeEventListener('keydown', onKeydown, true);
            keyBtn.removeEventListener('blur', onBlur);
            keyBtn.classList.remove('recording');
            activeRecorder = null;
          };

          document.addEventListener('keydown', onKeydown, true);
          keyBtn.addEventListener('blur', onBlur);
          activeRecorder = { cleanup };
        });

        // Reset button
        resetBtn.addEventListener('click', () => {
          cleanupRecorder();
          shortcutManager.resetOverride(shortcut.id);
          renderSection('shortcuts');
        });

        row.appendChild(label);
        row.appendChild(keyBtn);
        row.appendChild(resetBtn);
        container.appendChild(row);
      }
    }
  }

  // Menu click handler
  menu.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.preferences-menu-item') as HTMLElement | null;
    if (target && target.dataset.section) {
      renderSection(target.dataset.section as Section);
    }
  });

  // Show initial section
  renderSection('general');

  btnConfirm.textContent = 'Done';
  overlay.classList.remove('hidden');

  // Clean up previous listeners
  if ((overlay as any)._cleanup) {
    (overlay as any)._cleanup();
    (overlay as any)._cleanup = null;
  }

  const save = () => {
    if (soundCheckbox) {
      appState.setPreference('soundOnSessionWaiting', soundCheckbox.checked);
    }
    if (historyCheckbox) {
      appState.setPreference('sessionHistoryEnabled', historyCheckbox.checked);
    }
    if (insightsCheckbox) {
      appState.setPreference('insightsEnabled', insightsCheckbox.checked);
    }
    if (sidebarCheckboxes) {
      appState.setPreference('sidebarViews', {
        configSections: sidebarCheckboxes.configSections.checked,
        gitPanel: sidebarCheckboxes.gitPanel.checked,
        sessionHistory: sidebarCheckboxes.sessionHistory.checked,
        costFooter: sidebarCheckboxes.costFooter.checked,
        readinessSection: sidebarCheckboxes.readinessSection.checked,
      });
    }
  };

  const handleConfirm = () => {
    cleanupRecorder();
    save();
    closeModal();
    modal.classList.remove('modal-wide');
    btnConfirm.textContent = 'Create';
  };

  const handleCancel = () => {
    cleanupRecorder();
    closeModal();
    modal.classList.remove('modal-wide');
    btnConfirm.textContent = 'Create';
  };

  const handleKeydown = (e: KeyboardEvent) => {
    // Don't intercept if we're recording a shortcut
    if (activeRecorder) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
  document.addEventListener('keydown', handleKeydown);

  (overlay as any)._cleanup = () => {
    cleanupRecorder();
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    document.removeEventListener('keydown', handleKeydown);
  };
}
