import { appState } from '../state.js';
import { createCustomSelect, type CustomSelectInstance } from './custom-select.js';
import { applyZoom, getZoomFactor, ZOOM_STEPS } from '../zoom.js';
import { shortcutManager, displayKeys, eventToAccelerator } from '../shortcuts.js';
import { loadProviderAvailability, getProviderAvailabilitySnapshot } from '../provider-availability.js';
import type { CliProviderMeta, ProviderId, SettingsValidationResult } from '../../shared/types.js';
import { hasProviderIssue, type ProviderStatus } from './setup-checks.js';
import { createModalShell, createModalButton } from './modal-shell.js';
import { showChromeImportModal } from './chrome-import-modal.js';
import { buildSection, dot, badge, mono } from './help-shared.js';

let cleanupFn: (() => void) | null = null;

type Section = 'general' | 'appearance' | 'browser' | 'shortcuts' | 'setup' | 'help' | 'about';

export function showPreferencesModal(initialSection: Section = 'general'): void {
  cleanupFn?.();
  cleanupFn = null;

  const { overlay, body: bodyEl, actions } = createModalShell({
    id: 'preferences-overlay',
    title: 'Preferences',
    wide: true,
  });
  bodyEl.innerHTML = '';
  actions.innerHTML = '';

  const btnCancel = createModalButton('Cancel', false);
  btnCancel.id = 'preferences-cancel';
  actions.appendChild(btnCancel);
  const btnConfirm = createModalButton('Done', true);
  btnConfirm.id = 'preferences-confirm';
  actions.appendChild(btnConfirm);

  // Build two-pane layout
  const layout = document.createElement('div');
  layout.className = 'preferences-layout';

  // Side menu
  const menu = document.createElement('div');
  menu.className = 'preferences-menu';

  const sections: { id: Section; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'appearance', label: 'Appearance' },
    { id: 'browser', label: 'Browser' },
    { id: 'shortcuts', label: 'Shortcuts' },
    { id: 'setup', label: 'Setup' },
    { id: 'help', label: 'Help' },
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
  let confirmCloseCheckbox: HTMLInputElement | null = null;
  let copyOnSelectCheckbox: HTMLInputElement | null = null;
  let defaultProviderSelect: CustomSelectInstance | null = null;
  let themeSelect: CustomSelectInstance | null = null;
  let zoomSelect: CustomSelectInstance | null = null;
  let zoomPrefUnsub: (() => void) | null = null;
  let debugModeCheckbox: HTMLInputElement | null = null;
  let sidebarCheckboxes: { gitPanel: HTMLInputElement; sessionHistory: HTMLInputElement; discussions: HTMLInputElement; fileTree: HTMLInputElement } | null = null;
  let boardCardMetricsCheckbox: HTMLInputElement | null = null;
  let activeRecorder: { cleanup: () => void } | null = null;
  const originalTheme = appState.preferences.theme ?? 'dark';

  function cleanupRecorder() {
    if (activeRecorder) {
      activeRecorder.cleanup();
      activeRecorder = null;
    }
  }

  function renderSection(section: Section) {
    cleanupRecorder();
    zoomPrefUnsub?.();
    zoomPrefUnsub = null;
    currentSection = section;
    content.innerHTML = '';

    // Update active menu item
    for (const [id, item] of menuItems) {
      item.classList.toggle('active', id === section);
    }

    if (section === 'general') {
      // Default provider dropdown
      const providerRow = document.createElement('div');
      providerRow.className = 'modal-toggle-field';

      const providerLabel = document.createElement('label');
      providerLabel.textContent = 'Default coding tool';

      const currentDefault = appState.preferences.defaultProvider ?? 'claude';

      const buildProviderOptions = (providers: CliProviderMeta[]) =>
        providers.map(p => ({ value: p.id, label: p.displayName }));

      let snapshot = getProviderAvailabilitySnapshot();
      if (snapshot) {
        defaultProviderSelect = createCustomSelect('pref-default-provider', buildProviderOptions(snapshot.providers), currentDefault);
      } else {
        defaultProviderSelect = createCustomSelect('pref-default-provider', [{ value: currentDefault, label: 'Loading…' }], currentDefault);
        loadProviderAvailability().then(() => {
          if (currentSection !== 'general') return;
          snapshot = getProviderAvailabilitySnapshot();
          if (snapshot) {
            if (defaultProviderSelect) defaultProviderSelect.destroy();
            defaultProviderSelect = createCustomSelect('pref-default-provider', buildProviderOptions(snapshot.providers), currentDefault);
            providerRow.querySelector('.custom-select')?.remove();
            providerRow.appendChild(defaultProviderSelect.element);
          }
        });
      }

      providerRow.appendChild(providerLabel);
      providerRow.appendChild(defaultProviderSelect.element);
      content.appendChild(providerRow);

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

      const confirmCloseRow = document.createElement('div');
      confirmCloseRow.className = 'modal-toggle-field';

      const confirmCloseLabel = document.createElement('label');
      confirmCloseLabel.htmlFor = 'pref-confirm-close-working';
      confirmCloseLabel.textContent = 'Confirm closing an active session';

      confirmCloseCheckbox = document.createElement('input');
      confirmCloseCheckbox.type = 'checkbox';
      confirmCloseCheckbox.id = 'pref-confirm-close-working';
      confirmCloseCheckbox.checked = appState.preferences.confirmCloseWorkingSession;

      confirmCloseRow.appendChild(confirmCloseLabel);
      confirmCloseRow.appendChild(confirmCloseCheckbox);
      content.appendChild(confirmCloseRow);

      const copyOnSelectRow = document.createElement('div');
      copyOnSelectRow.className = 'modal-toggle-field';

      const copyOnSelectLabel = document.createElement('label');
      copyOnSelectLabel.htmlFor = 'pref-copy-on-select';
      copyOnSelectLabel.textContent = 'Copy on select';

      copyOnSelectCheckbox = document.createElement('input');
      copyOnSelectCheckbox.type = 'checkbox';
      copyOnSelectCheckbox.id = 'pref-copy-on-select';
      copyOnSelectCheckbox.checked = appState.preferences.copyOnSelect ?? false;

      copyOnSelectRow.appendChild(copyOnSelectLabel);
      copyOnSelectRow.appendChild(copyOnSelectCheckbox);
      content.appendChild(copyOnSelectRow);

    } else if (section === 'appearance') {
      const themeRow = document.createElement('div');
      themeRow.className = 'modal-toggle-field';

      const themeLabel = document.createElement('label');
      themeLabel.textContent = 'Theme';

      themeSelect = createCustomSelect(
        'pref-theme',
        [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }],
        originalTheme,
        (value) => { document.documentElement.dataset.theme = value; },
      );

      themeRow.appendChild(themeLabel);
      themeRow.appendChild(themeSelect.element);
      content.appendChild(themeRow);

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
      content.appendChild(zoomRow);

      zoomPrefUnsub?.();
      zoomPrefUnsub = appState.on('preferences-changed', () => {
        zoomSelect?.setValue(String(getZoomFactor()));
      });

      const sidebarViewsHeading = document.createElement('div');
      sidebarViewsHeading.className = 'preferences-subheading';
      sidebarViewsHeading.textContent = 'Sidebar Views';
      content.appendChild(sidebarViewsHeading);

      const views = appState.preferences.sidebarViews ?? { gitPanel: true, sessionHistory: true, discussions: true, fileTree: true };
      const toggles: { key: keyof typeof views; label: string }[] = [
        { key: 'fileTree', label: 'Project File Tree' },
        { key: 'gitPanel', label: 'Git Panel' },
        { key: 'sessionHistory', label: 'Session History' },
        { key: 'discussions', label: 'Discussions' },
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
        cb.checked = views[toggle.key] ?? true;

        row.appendChild(label);
        row.appendChild(cb);
        content.appendChild(row);
        checkboxes[toggle.key] = cb;
      }
      sidebarCheckboxes = checkboxes as typeof sidebarCheckboxes;

      const boardHeading = document.createElement('div');
      boardHeading.className = 'preferences-subheading';
      boardHeading.textContent = 'Board';
      content.appendChild(boardHeading);

      const boardMetricsRow = document.createElement('div');
      boardMetricsRow.className = 'modal-toggle-field';

      const boardMetricsLabel = document.createElement('label');
      boardMetricsLabel.htmlFor = 'pref-board-card-metrics';
      boardMetricsLabel.textContent = 'Show metrics on cards';

      boardCardMetricsCheckbox = document.createElement('input');
      boardCardMetricsCheckbox.type = 'checkbox';
      boardCardMetricsCheckbox.id = 'pref-board-card-metrics';
      boardCardMetricsCheckbox.checked = appState.preferences.boardCardMetrics ?? true;

      boardMetricsRow.appendChild(boardMetricsLabel);
      boardMetricsRow.appendChild(boardCardMetricsCheckbox);
      content.appendChild(boardMetricsRow);

    } else if (section === 'browser') {
      renderBrowserSection(content);

    } else if (section === 'shortcuts') {
      renderShortcutsSection(content);

    } else if (section === 'setup') {
      renderSetupSection(content);

    } else if (section === 'help') {
      renderHelpSection(content);

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

      const debugRow = document.createElement('div');
      debugRow.className = 'modal-toggle-field';

      const debugLabel = document.createElement('label');
      debugLabel.htmlFor = 'pref-debug-mode';
      debugLabel.textContent = 'Debug Mode';

      debugModeCheckbox = document.createElement('input');
      debugModeCheckbox.type = 'checkbox';
      debugModeCheckbox.id = 'pref-debug-mode';
      debugModeCheckbox.checked = appState.preferences.debugMode;

      debugRow.appendChild(debugLabel);
      debugRow.appendChild(debugModeCheckbox);

      aboutDiv.appendChild(appName);
      aboutDiv.appendChild(versionLine);
      aboutDiv.appendChild(updateRow);
      aboutDiv.appendChild(linksDiv);
      aboutDiv.appendChild(communityDiv);
      aboutDiv.appendChild(debugRow);
      content.appendChild(aboutDiv);

      window.vibeyard.app.getVersion().then((ver) => {
        versionLine.textContent = `Version: ${ver}`;
      });
    }
  }

  function renderHelpSection(container: HTMLElement) {
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
  }

  function renderBrowserSection(container: HTMLElement) {
    const intro = document.createElement('div');
    intro.className = 'preferences-intro';
    intro.textContent =
      'Bring your sign-ins into the embedded browser by importing cookies from Chrome. Imported cookies live in a shared browser session shared across browser tabs.';
    container.appendChild(intro);

    const summary = document.createElement('div');
    summary.className = 'preferences-browser-summary';
    summary.textContent = 'Loading…';
    container.appendChild(summary);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'preferences-browser-actions';
    container.appendChild(actionsRow);

    const importButton = document.createElement('button');
    importButton.className = 'btn-primary';
    importButton.textContent = 'Import from Chrome…';
    importButton.addEventListener('click', () => {
      showChromeImportModal(() => { refreshSummary(); });
    });
    actionsRow.appendChild(importButton);

    const clearCookiesBtn = document.createElement('button');
    clearCookiesBtn.className = 'btn-secondary';
    clearCookiesBtn.textContent = 'Clear imported cookies';
    clearCookiesBtn.addEventListener('click', async () => {
      if (!confirm('Clear all cookies from the shared browser session? Imported logins will be lost.')) return;
      await window.vibeyard.chromeImport.clearCookies();
      refreshSummary();
    });
    actionsRow.appendChild(clearCookiesBtn);

    const footnote = document.createElement('div');
    footnote.className = 'preferences-footnote';
    footnote.textContent =
      'Per-tab isolation: toggle "Shared/Isolated" in the browser tab toolbar to give a tab a private cookie jar that doesn’t see imports.';
    container.appendChild(footnote);

    function refreshSummary() {
      window.vibeyard.chromeImport.summary().then((s) => {
        if (currentSection !== 'browser') return;
        if (s.lastImportedAt === 0 && s.cookieCount === 0) {
          summary.textContent = 'No cookies imported yet.';
          clearCookiesBtn.disabled = true;
          return;
        }
        const date = s.lastImportedAt > 0 ? new Date(s.lastImportedAt).toLocaleString() : 'never';
        summary.textContent = `Last imported: ${date} — ${s.cookieCount} cookies.`;
        clearCookiesBtn.disabled = s.cookieCount === 0;
      }).catch(() => {
        summary.textContent = 'Couldn’t read import summary.';
      });
    }

    refreshSummary();
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

  async function fixAndRerender(providerId?: string) {
    await window.vibeyard.settings.reinstall(providerId);
    renderSection('setup');
  }

  function renderProviderHeader(parent: HTMLElement, displayName: string) {
    const header = document.createElement('div');
    header.className = 'setup-provider-header';
    header.textContent = displayName;
    parent.appendChild(header);
  }

  async function fetchProviderStatuses(): Promise<ProviderStatus[]> {
    const providers = await window.vibeyard.provider.listProviders();
    return Promise.all(
      providers.map(meta =>
        Promise.all([
          window.vibeyard.settings.validate(meta.id),
          window.vibeyard.provider.checkBinary(meta.id),
        ]).then(([validation, binaryOk]) => ({ meta, validation, binaryOk })),
      ),
    );
  }

  async function renderSetupSection(container: HTMLElement) {
    const section = document.createElement('div');
    section.className = 'setup-section';

    const loading = document.createElement('div');
    loading.className = 'setup-loading';
    loading.textContent = 'Checking configuration\u2026';
    section.appendChild(loading);
    container.appendChild(section);

    const results = await fetchProviderStatuses();

    if (currentSection !== 'setup') return;

    applySetupBadge(results.some(hasProviderIssue));

    section.innerHTML = '';

    for (const { meta, validation, binaryOk } of results) {
      renderProviderHeader(section, meta.displayName);

      renderCheckItem(section, {
        label: meta.displayName,
        description: `The ${meta.binaryName} binary must be installed for sessions to work.`,
        ok: binaryOk,
        statusText: binaryOk ? 'Installed' : 'Not found',
        helpText: binaryOk ? undefined : `${meta.binaryName} not found.`,
      });

      if (!binaryOk) continue;

      const { capabilities } = meta;

      if (capabilities.costTracking || capabilities.contextWindow) {
        const slOk = validation.statusLine === 'vibeyard';
        let slStatus = 'Configured';
        if (validation.statusLine === 'missing') slStatus = 'Not configured';
        else if (validation.statusLine === 'foreign') slStatus = 'Overwritten by another tool';

        renderCheckItem(section, {
          label: 'Status Line',
          description: 'Required for cost tracking and context window monitoring.',
          ok: slOk,
          statusText: slStatus,
          onFix: slOk ? undefined : () => fixAndRerender(meta.id),
        });
      }

      if (capabilities.hookStatus) {
        const hooksOk = validation.hooks === 'complete';
        let hooksStatus = 'All hooks installed';
        if (validation.hooks === 'missing') hooksStatus = 'No hooks installed';
        else if (validation.hooks === 'partial') hooksStatus = 'Some hooks missing';

        renderCheckItem(section, {
          label: 'Session Hooks',
          description: 'Required for session activity tracking.',
          ok: hooksOk,
          statusText: hooksStatus,
          onFix: hooksOk ? undefined : () => fixAndRerender(meta.id),
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

        if (capabilities.costTracking && validation.statusLine !== 'vibeyard' && !hooksOk) {
          const fixAllRow = document.createElement('div');
          fixAllRow.className = 'setup-fix-all-row';

          const fixAllBtn = document.createElement('button');
          fixAllBtn.className = 'setup-fix-btn';
          fixAllBtn.textContent = 'Fix All';
          fixAllBtn.addEventListener('click', async () => {
            fixAllBtn.disabled = true;
            fixAllBtn.textContent = 'Fixing\u2026';
            try {
              await fixAndRerender(meta.id);
            } catch {
              fixAllBtn.disabled = false;
              fixAllBtn.textContent = 'Fix All';
            }
          });

          fixAllRow.appendChild(fixAllBtn);
          section.appendChild(fixAllRow);
        }
      }
    }
  }

  function applySetupBadge(hasIssue: boolean) {
    const setupItem = menuItems.get('setup');
    if (setupItem) {
      setupItem.classList.toggle('has-badge', hasIssue);
    }
  }

  async function updateSetupBadge() {
    const results = await fetchProviderStatuses();
    applySetupBadge(results.some(hasProviderIssue));
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
  renderSection(initialSection);

  overlay.style.display = '';

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
    if (confirmCloseCheckbox) {
      appState.setPreference('confirmCloseWorkingSession', confirmCloseCheckbox.checked);
    }
    if (copyOnSelectCheckbox) {
      appState.setPreference('copyOnSelect', copyOnSelectCheckbox.checked);
    }
    if (defaultProviderSelect) {
      appState.setPreference('defaultProvider', defaultProviderSelect.getValue() as ProviderId);
    }
    if (themeSelect) {
      appState.setPreference('theme', themeSelect.getValue() as 'dark' | 'light');
    }
    if (debugModeCheckbox && debugModeCheckbox.checked !== appState.preferences.debugMode) {
      appState.setPreference('debugMode', debugModeCheckbox.checked);
      window.vibeyard.menu.rebuild(debugModeCheckbox.checked);
    }
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
  };

  const close = () => {
    overlay.style.display = 'none';
    cleanupFn?.();
    cleanupFn = null;
  };

  const handleConfirm = () => {
    save();
    close();
  };

  const handleCancel = () => {
    document.documentElement.dataset.theme = originalTheme;
    close();
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

  cleanupFn = () => {
    cleanupRecorder();
    zoomPrefUnsub?.();
    zoomPrefUnsub = null;
    if (defaultProviderSelect) defaultProviderSelect.destroy();
    if (themeSelect) themeSelect.destroy();
    if (zoomSelect) zoomSelect.destroy();
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    document.removeEventListener('keydown', handleKeydown);
  };
}
