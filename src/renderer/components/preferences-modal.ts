import { appState } from '../state.js';
import { createModalShell, createModalButton } from './modal-shell.js';
import { pushModal } from './modal-manager.js';
import { t } from '../i18n.js';
import type { PreferencesContext, Section, SectionController } from './preferences/section.js';
import { createGeneralSection } from './preferences/general-section.js';
import { createAppearanceSection } from './preferences/appearance-section.js';
import { createBrowserSection } from './preferences/browser-section.js';
import { createShortcutsSection } from './preferences/shortcuts-section.js';
import { createProfilesSection } from './preferences/profiles-section.js';
import { createSetupSection, updateSetupBadge } from './preferences/setup-section.js';
import { createAboutSection } from './preferences/about-section.js';
import { createHelpSection } from './preferences/help-section.js';

let cleanupFn: (() => void) | null = null;

let openModal: (() => void) | null = null;

const SECTIONS: { id: Section; labelKey: string; create: (ctx: PreferencesContext) => SectionController }[] = [
  { id: 'general', labelKey: 'preferencesNav.general', create: createGeneralSection },
  { id: 'appearance', labelKey: 'preferencesNav.appearance', create: createAppearanceSection },
  { id: 'browser', labelKey: 'preferencesNav.browser', create: createBrowserSection },
  { id: 'shortcuts', labelKey: 'preferencesNav.shortcuts', create: createShortcutsSection },
  { id: 'profiles', labelKey: 'preferencesNav.profiles', create: createProfilesSection },
  { id: 'setup', labelKey: 'preferencesNav.setup', create: createSetupSection },
  { id: 'help', labelKey: 'preferencesNav.help', create: createHelpSection },
  { id: 'about', labelKey: 'preferencesNav.about', create: createAboutSection },
];

/** Re-translate an open preferences modal in place. No-op when closed. */
export function rerenderOpenPreferencesModal(): void {
  openModal?.();
}

export function showPreferencesModal(initialSection: Section = 'general'): void {
  cleanupFn?.();
  cleanupFn = null;

  const { overlay, body: bodyEl, actions, titleEl } = createModalShell({
    id: 'preferences-overlay',
    title: t('preferences.title'),
    wide: true,
  });
  bodyEl.innerHTML = '';
  actions.innerHTML = '';

  const btnCancel = createModalButton(t('preferences.cancel'), false);
  btnCancel.id = 'preferences-cancel';
  actions.appendChild(btnCancel);
  const btnConfirm = createModalButton(t('preferences.done'), true);
  btnConfirm.id = 'preferences-confirm';
  actions.appendChild(btnConfirm);

  // Build two-pane layout
  const layout = document.createElement('div');
  layout.className = 'preferences-layout';

  const menu = document.createElement('div');
  menu.className = 'preferences-menu';

  const menuItems: Map<Section, HTMLDivElement> = new Map();
  for (const section of SECTIONS) {
    const item = document.createElement('div');
    item.className = 'preferences-menu-item';
    item.textContent = t(section.labelKey);
    item.dataset.section = section.id;
    menu.appendChild(item);
    menuItems.set(section.id, item);
  }

  const content = document.createElement('div');
  content.className = 'preferences-content';

  layout.appendChild(menu);
  layout.appendChild(content);
  bodyEl.appendChild(layout);

  const originalTheme = appState.preferences.theme ?? 'dark';
  let currentSection: Section = initialSection;
  let activeRecorder: { cleanup: () => void } | null = null;
  // Section controllers persist for the modal's lifetime once instantiated, so
  // their refs (and thus save()) survive section switches — only sections the
  // user actually opened get saved.
  const controllers: Map<Section, SectionController> = new Map();

  const ctx: PreferencesContext = {
    isActiveSection: (section) => currentSection === section,
    rerenderSection: (section) => renderSection(section),
    setSetupBadge: (hasIssue) => {
      menuItems.get('setup')?.classList.toggle('has-badge', hasIssue);
    },
    beginRecorder: (recorder) => { activeRecorder = recorder; },
    endRecorder: () => {
      if (activeRecorder) {
        activeRecorder.cleanup();
        activeRecorder = null;
      }
    },
    originalTheme,
  };

  function renderSection(section: Section) {
    controllers.get(currentSection)?.onLeave?.();
    ctx.endRecorder();
    currentSection = section;
    content.innerHTML = '';

    for (const [id, item] of menuItems) {
      item.classList.toggle('active', id === section);
    }

    let controller = controllers.get(section);
    if (!controller) {
      const factory = SECTIONS.find((s) => s.id === section)!.create;
      controller = factory(ctx);
      controllers.set(section, controller);
    }
    controller.render(content);
  }

  // On-open badge check (independent of visiting the Setup section).
  updateSetupBadge(ctx);

  menu.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest('.preferences-menu-item') as HTMLElement | null;
    if (target && target.dataset.section && target.dataset.section !== currentSection) {
      renderSection(target.dataset.section as Section);
    }
  });

  renderSection(initialSection);

  overlay.style.display = '';

  const save = () => {
    for (const controller of controllers.values()) {
      controller.save?.();
    }
  };

  const close = () => {
    overlay.style.display = 'none';
    cleanupFn?.();
    cleanupFn = null;
  };

  const handleConfirm = () => {
    save();
    close();
  };

  const handleCancel = () => {
    document.documentElement.dataset.theme = originalTheme;
    close();
  };

  const handleKeydown = (e: KeyboardEvent) => {
    // Don't intercept Enter while recording a shortcut. ESC is handled by the
    // centralized modal manager (capture phase) so it works over a focused
    // terminal and never leaks to the PTY.
    if (activeRecorder) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  };

  // ESC during shortcut recording is a consumed no-op (the recorder owns keys).
  const unregisterEsc = pushModal({
    onEscape: handleCancel,
    canEscape: () => activeRecorder == null,
  });

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
  document.addEventListener('keydown', handleKeydown);

  cleanupFn = () => {
    ctx.endRecorder();
    for (const controller of controllers.values()) {
      controller.destroy?.();
    }
    unregisterEsc();
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    document.removeEventListener('keydown', handleKeydown);
    openModal = null;
  };

  openModal = () => {
    // Refresh the modal title and footer buttons (in case they were re-translated).
    titleEl.textContent = t('preferences.title');
    btnCancel.textContent = t('preferences.cancel');
    btnConfirm.textContent = t('preferences.done');
    // Refresh the sidebar menu labels.
    for (const section of SECTIONS) {
      menuItems.get(section.id)!.textContent = t(section.labelKey);
    }
    // Re-render the active section content into a fresh container so all
    // textContent / placeholder strings pick up the new locale. Section
    // controllers persist (so user-typed input would survive a section
    // switch but NOT a full locale change — acceptable for v1).
    controllers.get(currentSection)?.destroy?.();
    controllers.delete(currentSection);
    renderSection(currentSection);
  };
}
