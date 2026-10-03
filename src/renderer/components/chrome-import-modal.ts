import { createModalShell, createModalButton } from './modal-shell.js';
import { bindModalDismiss } from './modal-manager.js';
import { createCustomSelect, type CustomSelectInstance } from './custom-select.js';
import type { ChromeProfile, ChromeImportProgress, ChromeImportResult } from '../../shared/types.js';

let cleanupFn: (() => void) | null = null;

export async function showChromeImportModal(onClosed?: () => void): Promise<void> {
  cleanupFn?.();
  cleanupFn = null;

  const { overlay, body, actions, titleEl } = createModalShell({
    id: 'chrome-import-overlay',
    title: 'Import cookies from Chrome',
  });
  body.innerHTML = '';
  actions.innerHTML = '';
  titleEl.textContent = 'Import cookies from Chrome';

  const intro = document.createElement('div');
  intro.className = 'chrome-import-intro';
  intro.textContent =
    'Import all cookies from your installed Chrome profile so the embedded browser starts already logged in to the sites you use.';
  body.appendChild(intro);

  const profileLabel = document.createElement('div');
  profileLabel.className = 'chrome-import-label';
  profileLabel.textContent = 'Chrome profile';
  body.appendChild(profileLabel);

  const profileSlot = document.createElement('div');
  profileSlot.className = 'chrome-import-profile-slot';
  body.appendChild(profileSlot);

  const note = document.createElement('div');
  note.className = 'chrome-import-note';
  body.appendChild(note);

  const progressBox = document.createElement('div');
  progressBox.className = 'chrome-import-progress';
  progressBox.style.display = 'none';
  body.appendChild(progressBox);

  const statusLine = document.createElement('div');
  statusLine.className = 'chrome-import-status';
  progressBox.appendChild(statusLine);

  const cookiesBar = document.createElement('div');
  cookiesBar.className = 'chrome-import-bar';
  cookiesBar.innerHTML = '<span class="chrome-import-bar-label">Cookies</span><span class="chrome-import-bar-counts">0 / 0</span><div class="chrome-import-bar-track"><div class="chrome-import-bar-fill"></div></div>';
  cookiesBar.style.display = 'none';
  progressBox.appendChild(cookiesBar);

  const cancelBtn = createModalButton('Cancel', false);
  const importBtn = createModalButton('Import', true);
  actions.appendChild(cancelBtn);
  actions.appendChild(importBtn);

  // Load profiles
  let profiles: ChromeProfile[] = [];
  try {
    profiles = await window.vibeyard.chromeImport.listProfiles();
  } catch (err) {
    note.textContent = `Failed to read Chrome profiles: ${(err as Error).message}`;
  }

  let select: CustomSelectInstance | null = null;
  if (profiles.length === 0) {
    note.textContent = 'Chrome installation not found. Install Google Chrome and sign in to a profile, then try again.';
    importBtn.disabled = true;
  } else {
    select = createCustomSelect(
      'chrome-import-profile-select',
      profiles.map((p) => ({ value: p.id, label: p.displayName })),
      profiles[0]!.id,
    );
    profileSlot.appendChild(select.element);

    note.innerHTML =
      'On macOS, the system may ask permission to read <strong>Chrome Safe Storage</strong> — click <em>Allow</em> when prompted. ' +
      'On Windows, cookies encrypted with Chrome 127+ App-Bound Encryption can’t be imported and will be skipped.';

    importBtn.addEventListener('click', async () => {
      importBtn.disabled = true;
      cancelBtn.disabled = true;

      progressBox.style.display = 'block';
      cookiesBar.style.display = 'flex';
      statusLine.textContent = 'Starting…';

      const unsub = window.vibeyard.chromeImport.onProgress((p: ChromeImportProgress) => {
        if (p.stage === 'starting') statusLine.textContent = 'Reading Chrome data…';
        else if (p.stage === 'copy') statusLine.textContent = 'Copying database files…';
        else if (p.stage === 'cookies') {
          const total = p.total ?? 0;
          const done = p.done ?? 0;
          updateBar(cookiesBar, done, total);
          statusLine.textContent = `Importing cookies… ${done}/${total}`;
        } else if (p.stage === 'done') {
          statusLine.textContent = 'Done.';
        } else if (p.stage === 'error') {
          statusLine.textContent = `Error: ${p.message || 'Unknown error'}`;
        }
      });

      let result: ChromeImportResult;
      try {
        result = await window.vibeyard.chromeImport.run({
          profileId: select!.getValue(),
        });
      } catch (err) {
        unsub();
        statusLine.textContent = `Failed: ${(err as Error).message}`;
        cancelBtn.disabled = false;
        cancelBtn.textContent = 'Close';
        return;
      }
      unsub();

      // Replace progress with summary
      progressBox.innerHTML = '';
      const summary = document.createElement('div');
      summary.className = 'chrome-import-summary';
      const lines: string[] = [`Imported ${result.cookieCount} cookies`];
      if (result.skippedV11 > 0) lines.push(`Skipped ${result.skippedV11} entries (Chrome v11 App-Bound Encryption)`);
      if (result.errors.length > 0) lines.push(`${result.errors.length} errors`);
      summary.textContent = lines.join(' · ');
      progressBox.appendChild(summary);

      importBtn.style.display = 'none';
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Done';
    });
  }

  function close() {
    overlay.style.display = 'none';
    cleanupFn?.();
    cleanupFn = null;
    onClosed?.();
  }

  cancelBtn.addEventListener('click', close);
  const teardownDismiss = bindModalDismiss({ overlay, onClose: close });

  cleanupFn = () => {
    select?.destroy();
    teardownDismiss();
  };

  overlay.style.display = 'flex';
}

function updateBar(bar: HTMLElement, done: number, total: number): void {
  const counts = bar.querySelector('.chrome-import-bar-counts');
  if (counts) counts.textContent = `${done} / ${total}`;
  const fill = bar.querySelector<HTMLElement>('.chrome-import-bar-fill');
  if (fill) fill.style.width = total > 0 ? `${Math.min(100, (done / total) * 100)}%` : '0%';
}
