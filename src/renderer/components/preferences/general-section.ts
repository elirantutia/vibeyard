import { appState } from '../../state.js';
import { createCustomSelect, type CustomSelectInstance } from '../custom-select.js';
import { loadProviderAvailability, getProviderAvailabilitySnapshot } from '../../provider-availability.js';
import type { CliProviderMeta, ProviderId } from '../../../shared/types.js';
import type { PreferencesContext, SectionController } from './section.js';
import { toggleRow } from './shared.js';

export function createGeneralSection(ctx: PreferencesContext): SectionController {
  let providerSelect: CustomSelectInstance | null = null;
  let soundCheckbox: HTMLInputElement | null = null;
  let notificationsCheckbox: HTMLInputElement | null = null;
  let historyCheckbox: HTMLInputElement | null = null;
  let insightsCheckbox: HTMLInputElement | null = null;
  let autoTitleCheckbox: HTMLInputElement | null = null;
  let confirmCloseCheckbox: HTMLInputElement | null = null;
  let copyOnSelectCheckbox: HTMLInputElement | null = null;

  return {
    render(container) {
      // Default provider dropdown
      const providerRow = document.createElement('div');
      providerRow.className = 'modal-toggle-field';

      const providerLabel = document.createElement('label');
      providerLabel.textContent = 'Default coding tool';

      const currentDefault = appState.preferences.defaultProvider ?? 'claude';
      const buildProviderOptions = (providers: CliProviderMeta[]) =>
        providers.map(p => ({ value: p.id, label: p.displayName }));

      if (providerSelect) providerSelect.destroy();
      let snapshot = getProviderAvailabilitySnapshot();
      if (snapshot) {
        providerSelect = createCustomSelect('pref-default-provider', buildProviderOptions(snapshot.providers), currentDefault);
      } else {
        providerSelect = createCustomSelect('pref-default-provider', [{ value: currentDefault, label: 'Loading…' }], currentDefault);
        loadProviderAvailability().then(() => {
          if (!ctx.isActiveSection('general')) return;
          snapshot = getProviderAvailabilitySnapshot();
          if (snapshot) {
            if (providerSelect) providerSelect.destroy();
            providerSelect = createCustomSelect('pref-default-provider', buildProviderOptions(snapshot.providers), currentDefault);
            providerRow.querySelector('.custom-select')?.remove();
            providerRow.appendChild(providerSelect.element);
          }
        });
      }

      providerRow.appendChild(providerLabel);
      providerRow.appendChild(providerSelect.element);
      container.appendChild(providerRow);

      const sound = toggleRow('pref-sound-on-waiting', 'Play sound when session finishes work', appState.preferences.soundOnSessionWaiting);
      soundCheckbox = sound.checkbox;
      container.appendChild(sound.row);

      const notif = toggleRow('pref-notifications-desktop', 'Desktop notifications when sessions need attention', appState.preferences.notificationsDesktop);
      notificationsCheckbox = notif.checkbox;
      container.appendChild(notif.row);

      const history = toggleRow('pref-session-history', 'Record session history when sessions close', appState.preferences.sessionHistoryEnabled);
      historyCheckbox = history.checkbox;
      container.appendChild(history.row);

      const insights = toggleRow('pref-insights-enabled', 'Show insight alerts', appState.preferences.insightsEnabled);
      insightsCheckbox = insights.checkbox;
      container.appendChild(insights.row);

      const autoTitle = toggleRow('pref-auto-title', 'Auto-name sessions from conversation title', appState.preferences.autoTitleEnabled);
      autoTitleCheckbox = autoTitle.checkbox;
      container.appendChild(autoTitle.row);

      const confirmClose = toggleRow('pref-confirm-close-working', 'Confirm closing an active session', appState.preferences.confirmCloseWorkingSession);
      confirmCloseCheckbox = confirmClose.checkbox;
      container.appendChild(confirmClose.row);

      const copyOnSelect = toggleRow('pref-copy-on-select', 'Copy on select', appState.preferences.copyOnSelect ?? false);
      copyOnSelectCheckbox = copyOnSelect.checkbox;
      container.appendChild(copyOnSelect.row);
    },

    save() {
      if (soundCheckbox) appState.setPreference('soundOnSessionWaiting', soundCheckbox.checked);
      if (notificationsCheckbox) appState.setPreference('notificationsDesktop', notificationsCheckbox.checked);
      if (historyCheckbox) appState.setPreference('sessionHistoryEnabled', historyCheckbox.checked);
      if (insightsCheckbox) appState.setPreference('insightsEnabled', insightsCheckbox.checked);
      if (autoTitleCheckbox) appState.setPreference('autoTitleEnabled', autoTitleCheckbox.checked);
      if (confirmCloseCheckbox) appState.setPreference('confirmCloseWorkingSession', confirmCloseCheckbox.checked);
      if (copyOnSelectCheckbox) appState.setPreference('copyOnSelect', copyOnSelectCheckbox.checked);
      if (providerSelect) appState.setPreference('defaultProvider', providerSelect.getValue() as ProviderId);
    },

    destroy() {
      if (providerSelect) providerSelect.destroy();
      providerSelect = null;
    },
  };
}
