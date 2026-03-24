import { appState } from '../state.js';
import { closeModal } from './modal.js';
import { shortcutManager, displayKeys, eventToAccelerator } from '../shortcuts.js';


const overlay = document.getElementById('modal-overlay')!;
const modal = document.getElementById('modal')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel')!;
const btnConfirm = document.getElementById('modal-confirm')!;

type Section = 'general' | 'sidebar' | 'shortcuts' | 'setup' | 'about';

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
    { id: 'setup', label: 'Setup' },
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
  let notificationsCheckbox: HTMLInputElement | null = null;
  let historyCheckbox: HTMLInputElement | null = null;
  let insightsCheckbox: HTMLInputElement | null = null;
  let autoTitleCheckbox: HTMLInputElement | null = null;
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

      const notifRow = document.createElement('div');
      notifRow.className = 'modal-toggle-field';

      const notifLabel = document.createElement('label');
      notifLabel.htmlFor = 'pref-notifications-desktop';
      notifLabel.textContent = 'Desktop notifications when sessions need attention';

      notificationsCheckbox = document.createElement('input');
      notificationsCheckbox.type = 'checkbox';
      notificationsCheckbox.id = 'pref-notifications-desktop';
      notificationsCheckbox.checked = appState.preferences.notificationsDesktop;

      notifRow.appendChild(notifLabel);
      notifRow.appendChild(notificationsCheckbox);
      content.appendChild(notifRow);

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

      const autoTitleRow = document.createElement('div');
      autoTitleRow.className = 'modal-toggle-field';

      const autoTitleLabel = document.createElement('label');
      autoTitleLabel.htmlFor = 'pref-auto-title';
      autoTitleLabel.textContent = 'Auto-name sessions from conversation title';

      autoTitleCheckbox = document.createElement('input');
      autoTitleCheckbox.type = 'checkbox';
      autoTitleCheckbox.id = 'pref-auto-title';
      autoTitleCheckbox.checked = appState.preferences.autoTitleEnabled;

      autoTitleRow.appendChild(autoTitleLabel);
      autoTitleRow.appendChild(autoTitleCheckbox);
      content.appendChild(autoTitleRow);

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

    } else if (section === 'setup') {
      renderSetupSection(content);

    } else if (section === 'about') {
      const aboutDiv = document.createElement('div');
      aboutDiv.className = 'about-section';

      const appName = document.createElement('div');
      appName.className = 'about-app-name';
      appName.textContent = 'Vibeyard';

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
        window.vibeyard.update.checkNow().then(() => {
          // If no update event fires within a few seconds, show "up to date"
          const timeout = setTimeout(() => {
            updateStatus.textContent = 'You\u2019re up to date.';
            updateBtn.disabled = false;
          }, 5000);
          const unsub = window.vibeyard.update.onAvailable((info) => {
            clearTimeout(timeout);
            updateStatus.textContent = `Update v${info.version} available — downloading...`;
            unsub();
          });
          const unsubErr = window.vibeyard.update.onError(() => {
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

      const linksDiv = document.createElement('div');
      linksDiv.className = 'about-links';

      const ghLink = document.createElement('a');
      ghLink.className = 'about-link';
      ghLink.textContent = 'GitHub';
      ghLink.href = '#';
      ghLink.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal('https://github.com/elirantutia/vibeyard'); });

      const bugLink = document.createElement('a');
      bugLink.className = 'about-link';
      bugLink.textContent = 'Report a Bug';
      bugLink.href = '#';
      bugLink.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal('https://github.com/elirantutia/vibeyard/issues'); });

      linksDiv.appendChild(ghLink);
      linksDiv.appendChild(bugLink);

      const communityDiv = document.createElement('div');
      communityDiv.className = 'about-community';
      communityDiv.append(
        'Vibeyard is open source. ',
        (() => { const a = document.createElement('a'); a.className = 'about-link'; a.href = '#'; a.textContent = 'Contribute on GitHub'; a.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal('https://github.com/elirantutia/vibeyard'); }); return a; })(),
        ' \u2014 and if you find it useful, give it a star!',
      );

      aboutDiv.appendChild(appName);
      aboutDiv.appendChild(versionLine);
      aboutDiv.appendChild(updateRow);
      aboutDiv.appendChild(linksDiv);
      aboutDiv.appendChild(communityDiv);
      content.appendChild(aboutDiv);

      window.vibeyard.app.getVersion().then((ver) => {
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

  function renderCheckItem(parent: HTMLElement, opts: {
    label: string;
    description: string;
    ok: boolean;
    statusText: string;
    helpText?: string;
    onFix?: () => Promise<void>;
  }) {
    const row = document.createElement('div');
    row.className = 'setup-check-row';

    const icon = document.createElement('span');
    icon.className = opts.ok ? 'setup-check-icon ok' : 'setup-check-icon error';
    icon.textContent = opts.ok ? '\u2713' : '\u2717';

    const info = document.createElement('div');
    info.className = 'setup-check-info';

    const title = document.createElement('div');
    title.className = 'setup-check-label';
    title.textContent = opts.label;

    const desc = document.createElement('div');
    desc.className = 'setup-check-desc';
    desc.textContent = opts.description;

    info.appendChild(title);
    info.appendChild(desc);

    if (!opts.ok && opts.helpText) {
      const help = document.createElement('div');
      help.className = 'setup-check-help';
      help.textContent = opts.helpText;
      info.appendChild(help);
    }

    const status = document.createElement('div');
    status.className = opts.ok ? 'setup-check-status ok' : 'setup-check-status error';
    status.textContent = opts.statusText;

    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(status);

    const { onFix } = opts;
    if (onFix) {
      const btn = document.createElement('button');
      btn.className = 'setup-fix-btn';
      btn.textContent = 'Fix';
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Fixing\u2026';
        try {
          await onFix();
        } catch {
          btn.disabled = false;
          btn.textContent = 'Fix';
        }
      });
      row.appendChild(btn);
    }

    parent.appendChild(row);
  }

  async function fixAndRerender() {
    await window.vibeyard.settings.reinstall();
    renderSection('setup');
  }

  async function renderSetupSection(container: HTMLElement) {
    const section = document.createElement('div');
    section.className = 'setup-section';

    const loading = document.createElement('div');
    loading.className = 'setup-loading';
    loading.textContent = 'Checking configuration\u2026';
    section.appendChild(loading);
    container.appendChild(section);

    const [validation, binary] = await Promise.all([
      window.vibeyard.settings.validate(),
      window.vibeyard.provider.checkBinary(),
    ]);

    if (currentSection !== 'setup') return;

    // Update badge from the data we already have
    applySetupBadge(!binary.ok || validation.statusLine !== 'vibeyard' || validation.hooks !== 'complete');

    section.innerHTML = '';

    renderCheckItem(section, {
      label: 'Claude Code CLI',
      description: 'The claude binary must be installed for sessions to work.',
      ok: binary.ok,
      statusText: binary.ok ? 'Installed' : 'Not found',
      helpText: binary.ok ? undefined : 'Install with: npm install -g @anthropic-ai/claude-code',
    });

    const slOk = validation.statusLine === 'vibeyard';
    let slStatus = 'Configured';
    if (validation.statusLine === 'missing') slStatus = 'Not configured';
    else if (validation.statusLine === 'foreign') slStatus = 'Overwritten by another tool';

    renderCheckItem(section, {
      label: 'Status Line',
      description: 'Required for cost tracking and context window monitoring.',
      ok: slOk,
      statusText: slStatus,
      onFix: slOk ? undefined : fixAndRerender,
    });

    const hooksOk = validation.hooks === 'complete';
    let hooksStatus = 'All hooks installed';
    if (validation.hooks === 'missing') hooksStatus = 'No hooks installed';
    else if (validation.hooks === 'partial') hooksStatus = 'Some hooks missing';

    renderCheckItem(section, {
      label: 'Session Hooks',
      description: 'Required for session activity tracking.',
      ok: hooksOk,
      statusText: hooksStatus,
      onFix: hooksOk ? undefined : fixAndRerender,
    });

    const hookList = document.createElement('div');
    hookList.className = 'setup-hook-details';
    for (const [event, installed] of Object.entries(validation.hookDetails)) {
      const item = document.createElement('div');
      item.className = 'setup-hook-item';
      const icon = document.createElement('span');
      icon.className = installed ? 'setup-check-icon ok' : 'setup-check-icon error';
      icon.textContent = installed ? '\u2713' : '\u2717';
      const name = document.createElement('span');
      name.className = 'setup-hook-name';
      name.textContent = event;
      item.appendChild(icon);
      item.appendChild(name);
      hookList.appendChild(item);
    }
    section.appendChild(hookList);

    if (!slOk && !hooksOk) {
      const fixAllRow = document.createElement('div');
      fixAllRow.className = 'setup-fix-all-row';

      const fixAllBtn = document.createElement('button');
      fixAllBtn.className = 'setup-fix-btn';
      fixAllBtn.textContent = 'Fix All';
      fixAllBtn.addEventListener('click', async () => {
        fixAllBtn.disabled = true;
        fixAllBtn.textContent = 'Fixing\u2026';
        try {
          await fixAndRerender();
        } catch {
          fixAllBtn.disabled = false;
          fixAllBtn.textContent = 'Fix All';
        }
      });

      fixAllRow.appendChild(fixAllBtn);
      section.appendChild(fixAllRow);
    }
  }

  function applySetupBadge(hasIssue: boolean) {
    const setupItem = menuItems.get('setup');
    if (setupItem) {
      setupItem.classList.toggle('has-badge', hasIssue);
    }
  }

  async function updateSetupBadge() {
    const [validation, binary] = await Promise.all([
      window.vibeyard.settings.validate(),
      window.vibeyard.provider.checkBinary(),
    ]);
    applySetupBadge(!binary.ok || validation.statusLine !== 'vibeyard' || validation.hooks !== 'complete');
  }
  updateSetupBadge();

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
    if (notificationsCheckbox) {
      appState.setPreference('notificationsDesktop', notificationsCheckbox.checked);
    }
    if (historyCheckbox) {
      appState.setPreference('sessionHistoryEnabled', historyCheckbox.checked);
    }
    if (insightsCheckbox) {
      appState.setPreference('insightsEnabled', insightsCheckbox.checked);
    }
    if (autoTitleCheckbox) {
      appState.setPreference('autoTitleEnabled', autoTitleCheckbox.checked);
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
