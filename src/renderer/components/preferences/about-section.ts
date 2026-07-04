import { appState } from '../../state.js';
import { t } from '../../i18n.js';
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
      appName.textContent = t('about.appName');

      const versionLine = document.createElement('div');
      versionLine.className = 'about-version';
      versionLine.textContent = t('about.versionLoading');

      const updateRow = document.createElement('div');
      updateRow.className = 'about-update-row';

      const updateBtn = document.createElement('button');
      updateBtn.className = 'about-update-btn';
      updateBtn.textContent = t('about.updateButton');

      const updateStatus = document.createElement('span');
      updateStatus.className = 'about-update-status';

      updateBtn.addEventListener('click', () => {
        updateBtn.disabled = true;
        updateStatus.textContent = t('about.updateChecking');
        window.vibeyard.update.checkNow().then(() => {
          // If no update event fires within a few seconds, show "up to date"
          const timeout = setTimeout(() => {
            updateStatus.textContent = t('about.upToDate');
            updateBtn.disabled = false;
          }, 5000);
          const unsub = window.vibeyard.update.onAvailable((info) => {
            clearTimeout(timeout);
            updateStatus.textContent = t('about.updateAvailable', { version: info.version });
            unsub();
          });
          const unsubErr = window.vibeyard.update.onError(() => {
            clearTimeout(timeout);
            updateStatus.textContent = t('about.updateFailed');
            updateBtn.disabled = false;
            unsubErr();
          });
        }).catch(() => {
          updateStatus.textContent = t('about.updateFailed');
          updateBtn.disabled = false;
        });
      });

      updateRow.appendChild(updateBtn);
      updateRow.appendChild(updateStatus);

      const linksDiv = document.createElement('div');
      linksDiv.className = 'about-links';

      const ghLink = document.createElement('a');
      ghLink.className = 'about-link';
      ghLink.textContent = t('about.githubLink');
      ghLink.href = '#';
      ghLink.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal(GITHUB_URL); });

      const bugLink = document.createElement('a');
      bugLink.className = 'about-link';
      bugLink.textContent = t('about.bugLink');
      bugLink.href = '#';
      bugLink.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal(ISSUES_URL); });

      linksDiv.appendChild(ghLink);
      linksDiv.appendChild(bugLink);

      const communityDiv = document.createElement('div');
      communityDiv.className = 'about-community';
      const contributeLink = document.createElement('a');
      contributeLink.className = 'about-link';
      contributeLink.href = '#';
      contributeLink.textContent = t('about.contributeLink');
      contributeLink.addEventListener('click', (e) => { e.preventDefault(); window.vibeyard.app.openExternal(GITHUB_URL); });
      communityDiv.append(
        t('about.communityPrefix'),
        contributeLink,
        t('about.communitySuffix'),
      );

      const debug = toggleRow('pref-debug-mode', t('about.debugModeLabel'), appState.preferences.debugMode);
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
        versionLine.textContent = t('about.versionLoaded', { ver });
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
