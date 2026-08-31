import { appState } from '../../../state.js';
import { esc, scoreColor } from '../../../dom-utils.js';
import { loadProviderAvailability, getAvailableProviderMetas, getProviderAvailabilitySnapshot, getProviderDisplayName } from '../../../provider-availability.js';
import { setPendingPrompt } from '../../terminal-pane.js';
import { promptNewSession } from '../../tab-bar.js';
import { attachHoverCard, hideHoverCard } from '../../hover-card.js';
import type { ReadinessCategory, ReadinessCheck, ReadinessCheckStatus, ReadinessResult, ReadinessEffort } from '../../../../shared/types.js';
import type { WidgetFactory, WidgetHost, WidgetInstance } from './widget-host.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GAUGE_RADIUS = 38;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;

type StatusFilter = ReadinessCheckStatus | 'all';

const EFFORT_MULTIPLIER: Record<ReadinessEffort, number> = {
  low: 1.0,
  medium: 0.6,
  high: 0.3,
};

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

function effortLabel(effort: ReadinessEffort): string {
  if (effort === 'low') return 'low effort';
  if (effort === 'medium') return 'medium effort';
  return 'high effort';
}

function impactLabel(impact: number): string {
  if (impact >= 75) return 'high impact';
  if (impact >= 45) return 'medium impact';
  return 'low impact';
}

function checkPriority(check: ReadinessCheck): number {
  const impact = check.impact ?? 50;
  const effort = check.effort ?? 'medium';
  return impact * EFFORT_MULTIPLIER[effort];
}

function selectQuickWins(result: ReadinessResult, n = 3): ReadinessCheck[] {
  const candidates: ReadinessCheck[] = [];
  for (const cat of result.categories) {
    for (const c of cat.checks) {
      // Informational rows are unbounded in number (one per nested instruction file) and
      // would otherwise crowd every scored failure out of the three quick-win slots.
      if ((c.status === 'fail' || c.status === 'warning') && c.fixPrompt && !c.informational) {
        candidates.push(c);
      }
    }
  }
  candidates.sort((a, b) => checkPriority(b) - checkPriority(a));
  return candidates.slice(0, n);
}

function countByStatus(result: ReadinessResult): Record<StatusFilter, number> {
  const counts: Record<StatusFilter, number> = { all: 0, fail: 0, warning: 0, pass: 0 };
  for (const cat of result.categories) {
    for (const c of cat.checks) {
      counts.all++;
      if (c.status === 'fail') counts.fail++;
      else if (c.status === 'warning') counts.warning++;
      else counts.pass++;
    }
  }
  return counts;
}

function handleFix(projectId: string, check: ReadinessCheck): void {
  if (!check.fixPrompt) return;
  const session = appState.addPlanSession(projectId, `Fix: ${check.name}`);
  if (!session) return;
  setPendingPrompt(session.id, check.fixPrompt);
}

function handleFixCustomSession(check: ReadinessCheck): void {
  if (!check.fixPrompt) return;
  promptNewSession((session) => {
    setPendingPrompt(session.id, check.fixPrompt!);
  });
}

function createGauge(score: number, prevScore: number | null, animateFromScore: number | null): HTMLElement {
  const container = document.createElement('div');
  container.className = 'readiness-gauge';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 96 96');
  svg.setAttribute('class', 'readiness-gauge-svg');
  svg.setAttribute('aria-label', `Readiness score: ${score}%`);

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('class', 'readiness-gauge-track');
  track.setAttribute('cx', '48');
  track.setAttribute('cy', '48');
  track.setAttribute('r', String(GAUGE_RADIUS));
  svg.appendChild(track);

  const targetOffset = GAUGE_CIRCUMFERENCE * (1 - score / 100);
  const startOffset = animateFromScore === null
    ? targetOffset
    : GAUGE_CIRCUMFERENCE * (1 - animateFromScore / 100);

  const arc = document.createElementNS(SVG_NS, 'circle');
  arc.setAttribute('class', 'readiness-gauge-arc');
  arc.setAttribute('cx', '48');
  arc.setAttribute('cy', '48');
  arc.setAttribute('r', String(GAUGE_RADIUS));
  arc.setAttribute('stroke', scoreColor(score));
  arc.setAttribute('stroke-dasharray', String(GAUGE_CIRCUMFERENCE));
  arc.setAttribute('stroke-dashoffset', String(startOffset));
  arc.setAttribute('transform', 'rotate(-90 48 48)');
  svg.appendChild(arc);

  container.appendChild(svg);

  const value = document.createElement('div');
  value.className = 'readiness-gauge-value';
  value.style.color = scoreColor(score);
  value.textContent = `${score}%`;
  container.appendChild(value);

  if (prevScore !== null) {
    const delta = score - prevScore;
    const deltaEl = document.createElement('div');
    deltaEl.className = 'readiness-gauge-delta';
    if (delta > 0) {
      deltaEl.classList.add('positive');
      deltaEl.textContent = `▲ +${delta}%`;
    } else if (delta < 0) {
      deltaEl.classList.add('negative');
      deltaEl.textContent = `▼ ${delta}%`;
    } else {
      deltaEl.classList.add('neutral');
      deltaEl.textContent = '— 0%';
    }
    container.appendChild(deltaEl);
  }

  if (animateFromScore !== null) {
    requestAnimationFrame(() => {
      arc.setAttribute('stroke-dashoffset', String(targetOffset));
    });
  }

  return container;
}

export const createReadinessWidget: WidgetFactory = (host: WidgetHost): WidgetInstance => {
  const projectId = host.projectId;
  const root = document.createElement('div');
  root.className = 'project-tab-readiness widget-readiness';

  let scanning = false;
  let destroyed = false;
  let lastExcludedKey = (appState.preferences.readinessExcludedProviders ?? []).join(',');
  let activeFilter: StatusFilter = 'all';
  let lastRenderedScore: number | null = null;
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
    if (check.rationale) {
      const infoBtn = document.createElement('button');
      infoBtn.type = 'button';
      infoBtn.className = 'readiness-info-btn';
      infoBtn.setAttribute('aria-label', 'Why this matters');
      infoBtn.textContent = 'i';
      attachHoverCard(infoBtn, check.rationale);
      name.appendChild(infoBtn);
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
        handleFix(projectId, check);
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

  const filterChecks = (checks: ReadinessCheck[]): ReadinessCheck[] => {
    if (activeFilter === 'all') return checks;
    if (activeFilter === 'fail') return checks.filter(c => c.status === 'fail');
    if (activeFilter === 'warning') return checks.filter(c => c.status === 'warning');
    return checks.filter(c => c.status === 'pass');
  };

  const renderCategory = (category: ReadinessCategory): HTMLElement | null => {
    const visibleChecks = filterChecks(category.checks);
    if (visibleChecks.length === 0) return null;

    const wrap = document.createElement('div');
    wrap.className = 'project-tab-readiness-category-wrap';

    const header = document.createElement('div');
    header.className = 'project-tab-readiness-category config-item-clickable';

    const expanded = expandedCategories.has(category.id) || activeFilter !== 'all';
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

    for (const check of visibleChecks) {
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

  const renderQuickWins = (result: ReadinessResult): HTMLElement | null => {
    const wins = selectQuickWins(result, 3);
    if (wins.length === 0) return null;

    const section = document.createElement('div');
    section.className = 'readiness-quick-wins';

    const header = document.createElement('div');
    header.className = 'readiness-quick-wins-header';
    header.innerHTML = `<span class="readiness-quick-wins-icon">⚡</span><span class="readiness-quick-wins-title">Quick wins</span><span class="readiness-quick-wins-sub">Top fixes ranked by effort × impact</span>`;
    section.appendChild(header);

    for (const check of wins) {
      const row = document.createElement('div');
      row.className = `readiness-quick-win-row ${statusClass(check.status)}`;

      const icon = document.createElement('span');
      icon.className = 'readiness-quick-win-bolt';
      icon.textContent = '⚡';
      row.appendChild(icon);

      const info = document.createElement('div');
      info.className = 'readiness-quick-win-info';

      const name = document.createElement('div');
      name.className = 'readiness-quick-win-name';
      name.textContent = check.name;
      info.appendChild(name);

      const meta = document.createElement('div');
      meta.className = 'readiness-quick-win-meta';
      const effort = check.effort ?? 'medium';
      const impact = check.impact ?? 50;
      meta.textContent = `${effortLabel(effort)} · ${impactLabel(impact)}`;
      info.appendChild(meta);

      row.appendChild(info);

      const fixBtn = document.createElement('button');
      fixBtn.className = 'readiness-fix-btn';
      fixBtn.textContent = 'Fix';
      fixBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleFix(projectId, check);
      });
      row.appendChild(fixBtn);

      section.appendChild(row);
    }

    return section;
  };

  const renderStatusChips = (result: ReadinessResult): HTMLElement => {
    const counts = countByStatus(result);
    const chips: { id: StatusFilter; label: string; count: number }[] = [
      { id: 'all', label: 'All', count: counts.all },
      { id: 'fail', label: 'Failing', count: counts.fail },
      { id: 'warning', label: 'Warnings', count: counts.warning },
      { id: 'pass', label: 'Passing', count: counts.pass },
    ];

    const row = document.createElement('div');
    row.className = 'readiness-status-chips';

    for (const chip of chips) {
      const pill = document.createElement('span');
      pill.className = 'tag-pill tag-pill-header readiness-status-chip';
      pill.dataset.color = chip.id === 'fail' ? 'red' : chip.id === 'warning' ? 'amber' : chip.id === 'pass' ? 'green' : 'gray';
      pill.dataset.filter = chip.id;
      if (chip.id !== activeFilter) pill.classList.add('inactive');
      pill.textContent = `${chip.label} ${chip.count}`;
      pill.addEventListener('click', () => {
        if (activeFilter === chip.id) {
          activeFilter = 'all';
        } else {
          activeFilter = chip.id;
        }
        render();
      });
      row.appendChild(pill);
    }

    return row;
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
        if (cb.checked) current.delete(meta.id);
        else current.add(meta.id);
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
    if (destroyed) return;
    root.innerHTML = '';
    const project = appState.projects.find(p => p.id === projectId);
    if (!project) return;
    const result = project.readiness;
    const history = project.readinessHistory ?? [];

    const toolbar = document.createElement('div');
    toolbar.className = 'widget-readiness-toolbar';

    const scanBtn = document.createElement('button');
    scanBtn.className = 'readiness-scan-btn';
    scanBtn.textContent = scanning ? 'Scanning...' : (result ? 'Rescan' : 'Scan');
    scanBtn.disabled = scanning;
    scanBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      void runScan();
    });
    toolbar.appendChild(scanBtn);

    root.appendChild(toolbar);

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

      const prevScore = history.length >= 2 ? history[history.length - 2].overallScore : null;
      const animateFrom = lastRenderedScore === null ? 0 : (lastRenderedScore !== result.overallScore ? lastRenderedScore : null);
      scoreRow.appendChild(createGauge(result.overallScore, prevScore, animateFrom));
      lastRenderedScore = result.overallScore;

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

      const quickWins = renderQuickWins(result);
      if (quickWins) body.appendChild(quickWins);

      const filter = renderProviderFilter();
      if (filter) body.appendChild(filter);

      body.appendChild(renderStatusChips(result));

      const categories = document.createElement('div');
      categories.className = 'project-tab-readiness-categories';

      let renderedAny = false;
      for (const category of result.categories) {
        const el = renderCategory(category);
        if (el) {
          categories.appendChild(el);
          renderedAny = true;
        }
      }

      if (!renderedAny) {
        const empty = document.createElement('div');
        empty.className = 'project-tab-empty readiness-filter-empty';
        empty.textContent = 'No checks match this filter.';
        categories.appendChild(empty);
      }

      body.appendChild(categories);
    }

    root.appendChild(body);
  };

  const runScan = async (silent = false) => {
    const project = appState.projects.find(p => p.id === projectId);
    if (!project || scanning) return;

    scanning = true;
    if (!silent) render();

    try {
      const excluded = appState.preferences.readinessExcludedProviders ?? [];
      const result = await window.vibeyard.readiness.analyze(project.path, excluded.length > 0 ? excluded : undefined);
      appState.setProjectReadiness(project.id, result);
    } catch (err) {
      console.warn('Readiness scan failed:', err);
    } finally {
      scanning = false;
      render();
    }
  };

  const autoScanIfNeeded = () => {
    const project = appState.projects.find(p => p.id === projectId);
    if (!project || scanning) return;
    void runScan(!!project.readiness);
  };

  const unsubReadiness = appState.on('readiness-changed', (data) => {
    const id = typeof data === 'string' ? data : undefined;
    if (id && id !== projectId) return;
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
      hideHoverCard();
    },
    refresh() {
      void runScan();
    },
  };
};
