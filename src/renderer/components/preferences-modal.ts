import { appState } from '../state.js';
import { createModalShell, createModalButton } from './modal-shell.js';
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

const SECTIONS: { id: Section; label: string; create: (ctx: PreferencesContext) => SectionController }[] = [
  { id: 'general', label: 'General', create: createGeneralSection },
  { id: 'appearance', label: 'Appearance', create: createAppearanceSection },
  { id: 'browser', label: 'Browser', create: createBrowserSection },
  { id: 'shortcuts', label: 'Shortcuts', create: createShortcutsSection },
  { id: 'profiles', label: 'Profiles', create: createProfilesSection },
  { id: 'setup', label: 'Setup', create: createSetupSection },
  { id: 'help', label: 'Help', create: createHelpSection },
  { id: 'about', label: 'About', create: createAboutSection },
];

export function showPreferencesModal(initialSection: Section = 'general'): void {
  cleanupFn?.();
  cleanupFn = null;

  const { overlay, body: bodyEl, actions } = createModalShell({
    id: 'preferences-overlay',
    title: 'Preferences',
    wide: true,
  });
  bodyEl.innerHTML = '';
  actions.innerHTML = '';

  const btnCancel = createModalButton('Cancel', false);
  btnCancel.id = 'preferences-cancel';
  actions.appendChild(btnCancel);
  const btnConfirm = createModalButton('Done', true);
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
    item.textContent = section.label;
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
    // Don't intercept if we're recording a shortcut
    if (activeRecorder) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCancel();
    }
  };

  btnConfirm.addEventListener('click', handleConfirm);
  btnCancel.addEventListener('click', handleCancel);
  document.addEventListener('keydown', handleKeydown);

  cleanupFn = () => {
    ctx.endRecorder();
    for (const controller of controllers.values()) {
      controller.destroy?.();
    }
    btnConfirm.removeEventListener('click', handleConfirm);
    btnCancel.removeEventListener('click', handleCancel);
    document.removeEventListener('keydown', handleKeydown);
  };
}
