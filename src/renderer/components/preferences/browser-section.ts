import { showChromeImportModal } from '../chrome-import-modal.js';
import { t } from '../../i18n.js';
import type { PreferencesContext, SectionController } from './section.js';

export function createBrowserSection(ctx: PreferencesContext): SectionController {
  return {
    render(container) {
      const intro = document.createElement('div');
      intro.className = 'preferences-intro';
      intro.textContent = t('browser.intro');
      container.appendChild(intro);

      const summary = document.createElement('div');
      summary.className = 'preferences-browser-summary';
      summary.textContent = t('browser.loading');
      container.appendChild(summary);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'preferences-browser-actions';
      container.appendChild(actionsRow);

      const importButton = document.createElement('button');
      importButton.className = 'btn-primary';
      importButton.textContent = t('browser.importButton');
      importButton.addEventListener('click', () => {
        showChromeImportModal(() => { refreshSummary(); });
      });
      actionsRow.appendChild(importButton);

      const clearCookiesBtn = document.createElement('button');
      clearCookiesBtn.className = 'btn-secondary';
      clearCookiesBtn.textContent = t('browser.clearButton');
      clearCookiesBtn.addEventListener('click', async () => {
        if (!confirm(t('browser.clearConfirm'))) return;
        await window.vibeyard.chromeImport.clearCookies();
        refreshSummary();
      });
      actionsRow.appendChild(clearCookiesBtn);

      const footnote = document.createElement('div');
      footnote.className = 'preferences-footnote';
      footnote.textContent = t('browser.footnote');
      container.appendChild(footnote);

      function refreshSummary() {
        window.vibeyard.chromeImport.summary().then((s) => {
          if (!ctx.isActiveSection('browser')) return;
          if (s.lastImportedAt === 0 && s.cookieCount === 0) {
            summary.textContent = t('browser.summaryEmpty');
            clearCookiesBtn.disabled = true;
            return;
          }
          const date = s.lastImportedAt > 0 ? new Date(s.lastImportedAt).toLocaleString() : t('browser.lastImportedNever');
          summary.textContent = t('browser.summaryTemplate', { date, cookieCount: s.cookieCount });
          clearCookiesBtn.disabled = s.cookieCount === 0;
        }).catch(() => {
          summary.textContent = t('browser.summaryError');
        });
      }

      refreshSummary();
    },
  };
}
