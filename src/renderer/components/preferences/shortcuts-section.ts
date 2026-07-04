import { shortcutManager, displayKeys, eventToAccelerator } from '../../shortcuts.js';
import { t } from '../../i18n.js';
import type { PreferencesContext, SectionController } from './section.js';

export function createShortcutsSection(ctx: PreferencesContext): SectionController {
  return {
    render(container) {
      const grouped = shortcutManager.getAll();

      for (const [category, shortcuts] of grouped) {
        const header = document.createElement('div');
        header.className = 'shortcut-category-header';
        header.textContent = category;
        container.appendChild(header);

        for (const shortcut of shortcuts) {
          const row = document.createElement('div');
          row.className = 'shortcut-row';

          const label = document.createElement('div');
          label.className = 'shortcut-row-label';
          label.textContent = shortcut.label;

          const keyBtn = document.createElement('button');
          keyBtn.className = 'shortcut-key-btn';
          keyBtn.textContent = displayKeys(shortcut.resolvedKeys);

          const hasOverride = shortcutManager.hasOverride(shortcut.id);
          if (hasOverride) {
            keyBtn.classList.add('customized');
          }

          const resetBtn = document.createElement('button');
          resetBtn.className = 'shortcut-reset-btn';
          resetBtn.textContent = t('shortcuts.resetButton');
          resetBtn.title = t('shortcuts.resetTooltip');
          if (!hasOverride) {
            resetBtn.style.visibility = 'hidden';
          }

          // Click key button to start recording
          keyBtn.addEventListener('click', () => {
            ctx.endRecorder();
            keyBtn.textContent = t('shortcuts.recordingPrompt');
            keyBtn.classList.add('recording');

            const onKeydown = (e: KeyboardEvent) => {
              e.preventDefault();
              e.stopPropagation();

              const accelerator = eventToAccelerator(e);
              if (!accelerator) return; // Bare modifier press

              shortcutManager.setOverride(shortcut.id, accelerator);
              ctx.endRecorder();
              ctx.rerenderSection('shortcuts');
            };

            const onBlur = () => {
              ctx.endRecorder();
              keyBtn.textContent = displayKeys(shortcutManager.getKeys(shortcut.id));
            };

            // cleanup only removes listeners + recording state; the orchestrator
            // clears its activeRecorder reference when endRecorder() invokes this.
            const cleanup = () => {
              document.removeEventListener('keydown', onKeydown, true);
              keyBtn.removeEventListener('blur', onBlur);
              keyBtn.classList.remove('recording');
            };

            document.addEventListener('keydown', onKeydown, true);
            keyBtn.addEventListener('blur', onBlur);
            ctx.beginRecorder({ cleanup });
          });

          resetBtn.addEventListener('click', () => {
            ctx.endRecorder();
            shortcutManager.resetOverride(shortcut.id);
            ctx.rerenderSection('shortcuts');
          });

          row.appendChild(label);
          row.appendChild(keyBtn);
          row.appendChild(resetBtn);
          container.appendChild(row);
        }
      }
    },

    onLeave() {
      ctx.endRecorder();
    },
  };
}
