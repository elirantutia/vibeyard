import { appState, ProjectRecord } from '../../state.js';
import { esc, scoreColor } from '../../dom-utils.js';
import { loadProviderAvailability, getAvailableProviderMetas, getProviderAvailabilitySnapshot, getProviderDisplayName } from '../../provider-availability.js';
import { setPendingPrompt } from '../terminal-pane.js';
import { promptNewSession } from '../tab-bar.js';
import type { ReadinessCategory, ReadinessCheck, ReadinessCheckStatus } from '../../../shared/types.js';

export interface ReadinessColumnInstance {
  element: HTMLElement;
  destroy(): void;
}

function statusIcon(status: ReadinessCheckStatus): string {
  if (status === 'pass') return '✓';
  if (status === 'warning') return '⚠';
  return '✗';
}

function statusClass(status: ReadinessCheckStatus): string {
  if (status === 'pass') return 'readiness-check-pass';
  if (status === 'warning') return 'readiness-check-warning';
  return 'readiness-check-fail';
}

function handleFix(check: ReadinessCheck): void {
  if (!check.fixPrompt) return;
  const project = appState.activeProject;
  if (!project) return;

  const session = appState.addPlanSession(project.id, `Fix: ${check.name}`);
  if (!session) return;

  setPendingPrompt(session.id, check.fixPrompt);
}

function handleFixCustomSession(check: ReadinessCheck): void {
  if (!check.fixPrompt) return;

  promptNewSession((session) => {
    setPendingPrompt(session.id, check.fixPrompt!);
  });
}

export function createReadinessColumn(project: ProjectRecord): ReadinessColumnInstance {
  const root = document.createElement('div');
  root.className = 'project-tab-column project-tab-readiness';

  let scanning = false;
  let destroyed = false;
  let lastExcludedKey = (appState.preferences.readinessExcludedProviders ?? []).join(',');
  const expandedCategories = new Set<string>();

  const renderCheck = (check: ReadinessCheck): HTMLElement => {
    const row = document.createElement('div');
    row.className = `readiness-check-row ${statusClass(check.status)}`;

    const icon = document.createElement('span');
    icon.className = 'readiness-check-icon';
    icon.textContent = statusIcon(check.status);

    const info = document.createElement('div');
    info.className = 'readiness-check-info';

    const name = document.createElement('div');
    name.className = 'readiness-check-name';
    name.appendChild(document.createTextNode(check.name));
    if (check.providerIds && check.providerIds.length > 0) {
      for (const pid of check.providerIds) {
        const tag = document.createElement('span');
        tag.className = 'readiness-provider-tag';
        tag.textContent = getProviderDisplayName(pid);
        name.appendChild(tag);
      }
    }

    const desc = document.createElement('div');
    desc.className = 'readiness-check-desc';
    desc.textContent = check.description;

    info.appendChild(name);
    info.appendChild(desc);

    row.appendChild(icon);
    row.appendChild(info);

    if (check.fixPrompt && check.status !== 'pass') {
      const fixGroup = document.createElement('div');
      fixGroup.className = 'readiness-fix-group';

      const fixBtn = document.createElement('button');
      fixBtn.className = 'readiness-fix-btn';
      fixBtn.textContent = 'Fix';
      fixBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleFix(check);
      });

      const customBtn = document.createElement('button');
      customBtn.className = 'readiness-fix-dropdown-btn';
      customBtn.textContent = '▼';
      customBtn.title = 'Fix in custom session';
      customBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleFixCustomSession(check);
      });

      fixGroup.appendChild(fixBtn);
      fixGroup.appendChild(customBtn);
      row.appendChild(fixGroup);
    }

    return row;
  };

  const renderCategory = (category: ReadinessCategory): HTMLElement => {
    const wrap = document.createElement('div');
    wrap.className = 'project-tab-readiness-category-wrap';

    const header = document.createElement('div');
    header.className = 'project-tab-readiness-category config-item-clickable';

    const expanded = expandedCategories.has(category.id);
    const color = scoreColor(category.score);

    header.innerHTML = `
      <span class="config-section-toggle${expanded ? '' : ' collapsed'}">&#x25BC;</span>
      <span class="project-tab-readiness-cat-name">${esc(category.name)}</span>
      <div class="project-tab-readiness-progress">
        <div class="project-tab-readiness-progress-fill" style="width:${category.score}%;background:${color}"></div>
      </div>
      <span class="project-tab-readiness-cat-score" style="color:${color}">${category.score}%</span>
    `;

    const body = document.createElement('div');
    body.className = 'project-tab-readiness-cat-body';
    if (!expanded) body.classList.add('hidden');

    for (const check of category.checks) {
      body.appendChild(renderCheck(check));
    }

    header.addEventListener('click', () => {
      const toggle = header.querySelector('.config-section-toggle');
      const nowExpanded = !expandedCategories.has(category.id);
      if (nowExpanded) expandedCategories.add(category.id);
      else expandedCategories.delete(category.id);
      body.classList.toggle('hidden', !nowExpanded);
      toggle?.classList.toggle('collapsed', !nowExpanded);
    });

    wrap.appendChild(header);
    wrap.appendChild(body);
    return wrap;
  };

  const renderProviderFilter = (): HTMLElement | null => {
    const metas = getAvailableProviderMetas();
    if (metas.length <= 1) return null;

    const section = document.createElement('div');
    section.className = 'readiness-filter-section';

    const description = document.createElement('span');
    description.className = 'readiness-filter-description';
    description.textContent = 'Uncheck a provider to exclude its checks from this readiness score.';
    section.appendChild(description);

    const row = document.createElement('div');
    row.className = 'readiness-filter-row';

    const label = document.createElement('span');
    label.className = 'readiness-filter-label';
    label.textContent = 'Include:';
    row.appendChild(label);

    const excluded = new Set(appState.preferences.readinessExcludedProviders ?? []);

    for (const meta of metas) {
      const toggle = document.createElement('label');
      toggle.className = 'readiness-filter-toggle';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !excluded.has(meta.id);
      cb.addEventListener('change', () => {
        const current = new Set(appState.preferences.readinessExcludedProviders ?? []);
        if (cb.checked) {
          current.delete(meta.id);
        } else {
          current.add(meta.id);
        }
        appState.setPreference('readinessExcludedProviders', [...current]);
      });

      toggle.appendChild(cb);
      toggle.appendChild(document.createTextNode(meta.displayName));
      row.appendChild(toggle);
    }

    section.appendChild(row);
    return section;
  };

  const render = () => {
    root.innerHTML = '';
    const freshProject = appState.projects.find(p => p.id === project.id) ?? project;
    const result = freshProject.readiness;

    const header = document.createElement('div');
    header.className = 'project-tab-section-header';

    const title = document.createElement('span');
    title.className = 'project-tab-section-title';
    title.textContent = 'AI Readiness';
    header.appendChild(title);

    const scanBtn = document.createElement('button');
    scanBtn.className = 'readiness-scan-btn';
    scanBtn.textContent = scanning ? 'Scanning...' : (result ? 'Rescan' : 'Scan');
    scanBtn.disabled = scanning;
    scanBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runScan();
    });
    header.appendChild(scanBtn);

    root.appendChild(header);

    const body = document.createElement('div');
    body.className = 'project-tab-readiness-body';

    if (scanning && !result) {
      const loading = document.createElement('div');
      loading.className = 'readiness-loading';
      loading.textContent = 'Analyzing project...';
      body.appendChild(loading);
    } else if (!result) {
      const empty = document.createElement('div');
      empty.className = 'project-tab-empty';
      empty.textContent = 'No scan yet. Click Scan to analyze this project.';
      body.appendChild(empty);
    } else {
      const scoreRow = document.createElement('div');
      scoreRow.className = 'project-tab-readiness-score-row';

      const scoreBadge = document.createElement('div');
      scoreBadge.className = 'project-tab-readiness-score';
      scoreBadge.style.background = scoreColor(result.overallScore);
      scoreBadge.textContent = `${result.overallScore}%`;
      scoreRow.appendChild(scoreBadge);

      const scoreInfo = document.createElement('div');
      scoreInfo.className = 'project-tab-readiness-score-info';

      const scoreLabel = document.createElement('div');
      scoreLabel.className = 'project-tab-readiness-score-label';
      scoreLabel.textContent = 'Overall readiness';
      scoreInfo.appendChild(scoreLabel);

      const scannedAt = document.createElement('div');
      scannedAt.className = 'project-tab-readiness-scanned-at';
      scannedAt.textContent = `Scanned ${new Date(result.scannedAt).toLocaleString()}`;
      scoreInfo.appendChild(scannedAt);

      scoreRow.appendChild(scoreInfo);

      body.appendChild(scoreRow);

      const filter = renderProviderFilter();
      if (filter) body.appendChild(filter);

      const categories = document.createElement('div');
      categories.className = 'project-tab-readiness-categories';

      for (const category of result.categories) {
        categories.appendChild(renderCategory(category));
      }

      body.appendChild(categories);
    }

    root.appendChild(body);
  };

  const runScan = async (silent = false) => {
    const freshProject = appState.projects.find(p => p.id === project.id);
    if (!freshProject || scanning) return;

    scanning = true;
    if (!silent) render();

    try {
      const excluded = appState.preferences.readinessExcludedProviders ?? [];
      const result = await window.vibeyard.readiness.analyze(freshProject.path, excluded.length > 0 ? excluded : undefined);
      appState.setProjectReadiness(freshProject.id, result);
    } catch (err) {
      console.warn('Readiness scan failed:', err);
    } finally {
      scanning = false;
      render();
    }
  };

  const autoScanIfNeeded = () => {
    const freshProject = appState.projects.find(p => p.id === project.id);
    if (!freshProject || scanning) return;
    void runScan(!!freshProject.readiness);
  };

  const unsubReadiness = appState.on('readiness-changed', (data) => {
    const projectId = typeof data === 'string' ? data : undefined;
    if (projectId && projectId !== project.id) return;
    render();
  });
  const unsubPrefs = appState.on('preferences-changed', () => {
    const newKey = (appState.preferences.readinessExcludedProviders ?? []).join(',');
    if (newKey !== lastExcludedKey) {
      lastExcludedKey = newKey;
      autoScanIfNeeded();
    }
  });

  render();
  autoScanIfNeeded();

  if (!getProviderAvailabilitySnapshot()) {
    void loadProviderAvailability().then(() => {
      if (!destroyed) render();
    });
  }

  return {
    element: root,
    destroy() {
      destroyed = true;
      unsubReadiness();
      unsubPrefs();
    },
  };
}
