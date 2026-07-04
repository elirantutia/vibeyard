import { createModalShell, createModalButton } from '../../modal-shell.js';
import { bindModalDismiss } from '../../modal-manager.js';
import type { OverviewWidget } from '../../../../shared/types.js';
import {
  DEFAULT_SESSIONS_CONFIG,
  SESSIONS_RECENT_LIMIT_MAX,
  SESSIONS_RECENT_LIMIT_MIN,
  type SessionsConfig,
} from './sessions-types.js';
import { t } from '../../../i18n.js';

export function showSessionsSettings(
  widget: OverviewWidget,
  onSave: (patch: Partial<SessionsConfig>) => void,
): void {
  const shell = createModalShell({ id: 'sessions-settings-modal', title: t('projectTab.sessionsSettings.title') });
  shell.body.innerHTML = '';
  shell.actions.innerHTML = '';

  const cfg = (widget.config ?? {}) as Partial<SessionsConfig>;
  const current: SessionsConfig = {
    recentLimit:
      typeof cfg.recentLimit === 'number' ? cfg.recentLimit : DEFAULT_SESSIONS_CONFIG.recentLimit,
  };

  const form = document.createElement('div');
  form.className = 'widget-settings-form';

  const limitField = document.createElement('div');
  limitField.className = 'widget-settings-field';

  const limitLabel = document.createElement('label');
  limitLabel.textContent = t('projectTab.sessionsSettings.limitLabel');
  limitLabel.htmlFor = 'sessions-settings-limit';
  limitField.appendChild(limitLabel);

  const limitInput = document.createElement('input');
  limitInput.type = 'number';
  limitInput.id = 'sessions-settings-limit';
  limitInput.min = String(SESSIONS_RECENT_LIMIT_MIN);
  limitInput.max = String(SESSIONS_RECENT_LIMIT_MAX);
  limitInput.value = String(current.recentLimit);
  limitField.appendChild(limitInput);

  const limitHelp = document.createElement('div');
  limitHelp.className = 'widget-settings-help';
  limitHelp.textContent = t('projectTab.sessionsSettings.limitHelp', { min: SESSIONS_RECENT_LIMIT_MIN, max: SESSIONS_RECENT_LIMIT_MAX });
  limitField.appendChild(limitHelp);

  form.appendChild(limitField);
  shell.body.appendChild(form);

  const cancel = createModalButton(t('projectTab.sessionsSettings.cancelButton'), false);
  cancel.addEventListener('click', close);
  shell.actions.appendChild(cancel);

  const save = createModalButton(t('projectTab.sessionsSettings.saveButton'), true);
  save.addEventListener('click', () => {
    const raw = parseInt(limitInput.value, 10);
    const clamped = Math.max(
      SESSIONS_RECENT_LIMIT_MIN,
      Math.min(SESSIONS_RECENT_LIMIT_MAX, isNaN(raw) ? DEFAULT_SESSIONS_CONFIG.recentLimit : raw),
    );
    onSave({ recentLimit: clamped });
    close();
  });
  shell.actions.appendChild(save);

  shell.overlay.style.display = 'flex';
  const teardownDismiss = bindModalDismiss({ overlay: shell.overlay, onClose: close });
  limitInput.focus();
  limitInput.select();

  function close(): void {
    shell.overlay.style.display = 'none';
    teardownDismiss();
  }
}
