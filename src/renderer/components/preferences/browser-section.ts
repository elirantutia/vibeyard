import { showChromeImportModal } from '../chrome-import-modal.js';
import type { PreferencesContext, SectionController } from './section.js';

export function createBrowserSection(ctx: PreferencesContext): SectionController {
  return {
    render(container) {
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
          if (!ctx.isActiveSection('browser')) return;
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
    },
  };
}
