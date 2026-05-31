import { appState } from '../../state.js';
import type { SectionController } from './section.js';
import { toggleRow } from './shared.js';

const GITHUB_URL = 'https://github.com/elirantutia/vibeyard';
const ISSUES_URL = 'https://github.com/elirantutia/vibeyard/issues';

export function createAboutSection(): SectionController {
  let debugModeCheckbox: HTMLInputElement | null = null;

  return {
    render(container) {
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
            updateStatus.textContent = 'You’re up to date.';
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
      ghLink.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal(GITHUB_URL); });

      const bugLink = document.createElement('a');
      bugLink.className = 'about-link';
      bugLink.textContent = 'Report a Bug';
      bugLink.href = '#';
      bugLink.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal(ISSUES_URL); });

      linksDiv.appendChild(ghLink);
      linksDiv.appendChild(bugLink);

      const communityDiv = document.createElement('div');
      communityDiv.className = 'about-community';
      const contributeLink = document.createElement('a');
      contributeLink.className = 'about-link';
      contributeLink.href = '#';
      contributeLink.textContent = 'Contribute on GitHub';
      contributeLink.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal(GITHUB_URL); });
      communityDiv.append(
        'Vibeyard is open source. ',
        contributeLink,
        ' — and if you find it useful, give it a star!',
      );

      const debug = toggleRow('pref-debug-mode', 'Debug Mode', appState.preferences.debugMode);
      const debugRow = debug.row;
      debugModeCheckbox = debug.checkbox;

      aboutDiv.appendChild(appName);
      aboutDiv.appendChild(versionLine);
      aboutDiv.appendChild(updateRow);
      aboutDiv.appendChild(linksDiv);
      aboutDiv.appendChild(communityDiv);
      aboutDiv.appendChild(debugRow);
      container.appendChild(aboutDiv);

      window.vibeyard.app.getVersion().then((ver) => {
        versionLine.textContent = `Version: ${ver}`;
      });
    },

    save() {
      if (debugModeCheckbox && debugModeCheckbox.checked !== appState.preferences.debugMode) {
        appState.setPreference('debugMode', debugModeCheckbox.checked);
        window.vibeyard.menu.rebuild(debugModeCheckbox.checked);
      }
    },
  };
}
