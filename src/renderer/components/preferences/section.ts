export type Section = 'general' | 'appearance' | 'browser' | 'shortcuts' | 'profiles' | 'setup' | 'help' | 'about';

/**
 * Passed to each section factory so sections can talk back to the orchestrator
 * (active-section guards, re-render, badge, shortcut recorder) without sharing
 * raw closure state.
 */
export interface PreferencesContext {
  /** True while `section` is the section currently shown — guards async work. */
  isActiveSection(section: Section): boolean;
  /** Re-render a section into the content pane (used after shortcut/setup mutations). */
  rerenderSection(section: Section): void;
  /** Toggle the issue badge on the Setup menu item. */
  setSetupBadge(hasIssue: boolean): void;
  /** Register an active shortcut-key recorder (so Enter/Escape don't close the modal). */
  beginRecorder(recorder: { cleanup: () => void }): void;
  /** Tear down the active shortcut-key recorder, if any. */
  endRecorder(): void;
  /** Theme captured when the modal opened — for live preview + cancel restore. */
  originalTheme: 'dark' | 'light';
}

/**
 * Returned by each `createXSection(ctx)` factory. The orchestrator keeps the
 * controllers it has instantiated for the modal's lifetime so per-section refs
 * (and thus `save()`) survive section switches.
 */
export interface SectionController {
  /** (Re)build the section's DOM into the content pane. */
  render(container: HTMLElement): void;
  /** Persist this section's preferences on Confirm. */
  save?(): void;
  /** Cleanup when switching away from this section (e.g. unsubscribe, stop recorder). */
  onLeave?(): void;
  /** Cleanup on modal close (e.g. destroy custom selects). */
  destroy?(): void;
}
