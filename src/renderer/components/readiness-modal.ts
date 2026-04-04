import { appState } from '../state.js';
import { closeModal } from './modal.js';
import { esc, scoreColor } from '../dom-utils.js';
import { setPendingPrompt } from './terminal-pane.js';
import { promptNewSession } from './tab-bar.js';
import { loadProviderMetas, getCachedProviderMetas, getProviderDisplayName } from '../provider-availability.js';
import type { ReadinessResult, ReadinessCategory, ReadinessCheck, ReadinessCheckStatus } from '../../shared/types.js';

const overlay = document.getElementById('modal-overlay')!;
const modal = document.getElementById('modal')!;
const titleEl = document.getElementById('modal-title')!;
const bodyEl = document.getElementById('modal-body')!;
const btnCancel = document.getElementById('modal-cancel')!;
const btnConfirm = document.getElementById('modal-confirm')!;

function statusIcon(status: ReadinessCheckStatus): string {
  if (status === 'pass') return '\u2713';
  if (status === 'warning') return '\u26A0';
  return '\u2717';
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

  closeReadinessModal();

  setPendingPrompt(session.id, check.fixPrompt!);
}

function handleFixCustomSession(check: ReadinessCheck): void {
  if (!check.fixPrompt) return;

  promptNewSession((session) => {
    closeReadinessModal();
    setPendingPrompt(session.id, check.fixPrompt!);
  });
}

function renderCategory(category: ReadinessCategory): HTMLElement {
  const section = document.createElement('div');
  section.className = 'readiness-modal-category';

  const header = document.createElement('div');
  header.className = 'readiness-modal-category-header';

  const color = scoreColor(category.score);
  header.innerHTML = `
    <span class="config-section-toggle collapsed">&#x25BC;</span>
    <span class="readiness-modal-category-name">${esc(category.name)}</span>
    <div class="readiness-progress-bar readiness-progress-bar-sm">
      <div class="readiness-progress-fill" style="width:${category.score}%;background:${color}"></div>
    </div>
    <span class="readiness-modal-category-score" style="color:${color}">${category.score}%</span>
  `;

  const body = document.createElement('div');
  body.className = 'readiness-modal-category-body hidden';

  for (const check of category.checks) {
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
      customBtn.textContent = '\u25BC';
      customBtn.title = 'Fix in custom session';
      customBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        handleFixCustomSession(check);
      });

      fixGroup.appendChild(fixBtn);
      fixGroup.appendChild(customBtn);
      row.appendChild(fixGroup);
    }

    body.appendChild(row);
  }

  header.addEventListener('click', () => {
    const toggle = header.querySelector('.config-section-toggle')!;
    toggle.classList.toggle('collapsed');
    body.classList.toggle('hidden');
  });

  section.appendChild(header);
  section.appendChild(body);
  return section;
}

export async function showReadinessModal(result: ReadinessResult): Promise<void> {
  titleEl.textContent = 'AI Readiness';
  bodyEl.innerHTML = '';
  modal.classList.add('modal-wide');

  const container = document.createElement('div');
  container.className = 'readiness-modal-container';

  // Overall score
  const scoreSection = document.createElement('div');
  scoreSection.className = 'readiness-modal-score';
  const color = scoreColor(result.overallScore);
  scoreSection.innerHTML = `
    <div class="readiness-score-circle" style="border-color:${color}">
      <span class="readiness-score-value" style="color:${color}">${result.overallScore}%</span>
    </div>
    <div class="readiness-score-label">Overall Score</div>
    <div class="readiness-score-date">Scanned ${new Date(result.scannedAt).toLocaleString()}</div>
  `;
  container.appendChild(scoreSection);

  // Provider filter — only shown when multiple providers are available
  await loadProviderMetas();
  const metas = getCachedProviderMetas();

  if (metas.length > 1) {
    const filterSection = document.createElement('div');
    filterSection.className = 'readiness-filter-section';

    const filterLabel = document.createElement('span');
    filterLabel.className = 'readiness-filter-label';
    filterLabel.textContent = 'Include:';
    filterSection.appendChild(filterLabel);

    const excluded = new Set(appState.preferences.readinessExcludedProviders ?? []);

    for (const meta of metas) {
      const label = document.createElement('label');
      label.className = 'readiness-filter-toggle';

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

      const text = document.createTextNode(meta.displayName);
      label.appendChild(cb);
      label.appendChild(text);
      filterSection.appendChild(label);
    }

    container.appendChild(filterSection);
  }

  // Categories
  for (const category of result.categories) {
    container.appendChild(renderCategory(category));
  }

  bodyEl.appendChild(container);

  btnConfirm.textContent = 'Done';
  overlay.classList.remove('hidden');

  if ((overlay as any)._cleanup) {
    (overlay as any)._cleanup();
    (overlay as any)._cleanup = null;
  }

  const handleConfirm = () => {
    closeReadinessModal();
  };

  const handleCancel = () => {
    closeReadinessModal();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      closeReadinessModal();
    }
  };

  const unsubReadiness = appState.on('readiness-changed', () => {
    // Defer to avoid infinite loop: showReadinessModal unsubscribes/resubscribes
    // during Set.forEach iteration, which would re-trigger the new listener
    setTimeout(() => {
      const project = appState.activeProject;
      if (project?.readiness && !overlay.classList.contains('hidden')) {
        showReadinessModal(project.readiness);
      }
    }, 0);
  });

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
  document.addEventListener('keydown', handleKeydown);

  (overlay as any)._cleanup = () => {
    unsubReadiness();
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    document.removeEventListener('keydown', handleKeydown);
  };
}

function closeReadinessModal(): void {
  closeModal();
  modal.classList.remove('modal-wide');
  btnConfirm.textContent = 'Create';
}
