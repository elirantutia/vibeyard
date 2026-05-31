import { hasProviderIssue, type ProviderStatus } from '../setup-checks.js';
import type { PreferencesContext, SectionController } from './section.js';

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
  icon.textContent = opts.ok ? '✓' : '✗';

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
      btn.textContent = 'Fixing…';
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

/** On-open badge check — independent of rendering the Setup section. */
export async function updateSetupBadge(ctx: PreferencesContext): Promise<void> {
  const results = await fetchProviderStatuses();
  ctx.setSetupBadge(results.some(hasProviderIssue));
}

export function createSetupSection(ctx: PreferencesContext): SectionController {
  async function fixAndRerender(providerId?: string) {
    await window.vibeyard.settings.reinstall(providerId);
    ctx.rerenderSection('setup');
  }

  return {
    async render(container) {
      const section = document.createElement('div');
      section.className = 'setup-section';

      const loading = document.createElement('div');
      loading.className = 'setup-loading';
      loading.textContent = 'Checking configuration…';
      section.appendChild(loading);
      container.appendChild(section);

      const results = await fetchProviderStatuses();

      if (!ctx.isActiveSection('setup')) return;

      ctx.setSetupBadge(results.some(hasProviderIssue));

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
            icon.textContent = installed ? '✓' : '✗';
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
              fixAllBtn.textContent = 'Fixing…';
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
    },
  };
}
