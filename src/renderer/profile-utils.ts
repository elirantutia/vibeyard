import { appState } from './state.js';
import { getProviderCapabilities, getProviderDisplayName } from './provider-availability.js';
import { resolveProfile } from './state/specialized-sessions.js';
import { t } from './i18n.js';
import type { SelectOption } from './components/custom-select.js';
import type { Profile, ProjectRecord, ProviderId } from '../shared/types.js';

/** Profiles whose provider declares `capabilities.profiles` (today: Claude, Pi, OMP). */
export function profileCapableProfiles(): Profile[] {
  return appState.profiles.filter((p) => getProviderCapabilities(p.providerId)?.profiles === true);
}

/**
 * Profile pick options for one coding tool: bare names, no provider suffix
 * (the tool is already known to the picker). Empty for providers without
 * profile support or with no profiles defined.
 */
export function providerProfileOptions(providerId: ProviderId): SelectOption[] {
  if (getProviderCapabilities(providerId)?.profiles !== true) return [];
  return appState.profiles
    .filter((p) => p.providerId === providerId)
    .map((p) => ({ value: p.id, label: p.name }));
}

/**
 * The project's configured coding tool, falling back to the active session
 * and then the global default for projects without an explicit choice.
 */
export function projectProviderId(project: ProjectRecord): ProviderId {
  const active = project.sessions.find((s) => s.id === project.activeSessionId);
  return project.defaultProvider ?? active?.providerId ?? appState.preferences.defaultProvider ?? 'claude';
}

/**
 * The badge a project card shows: its current coding tool plus the profile
 * that tool actually runs under. Resolution goes through the same
 * `resolveProfile` chain used when a PTY spawns — project pin → the tool's
 * global default (`preferences.defaultProfiles[tool]`), provider-matched — so
 * the card cannot drift from what a new session in that project actually gets.
 *
 * Because the chain requires `profile.providerId === tool`, a project pin left
 * over from a *different* tool resolves to nothing and renders as the current
 * tool's "Default" rather than the stale profile's name.
 *
 * Undefined when there is nothing to disambiguate: fewer than two
 * profile-capable profiles exist across all tools, or the current tool has no
 * profile concept at all.
 */
export function projectProfileBadge(
  project: ProjectRecord,
): { tool: string; profile: string } | undefined {
  if (profileCapableProfiles().length <= 1) return undefined;
  const providerId = projectProviderId(project);
  if (getProviderCapabilities(providerId)?.profiles !== true) return undefined;
  const profile = resolveProfile(undefined, project, appState.preferences, providerId, appState.profiles);
  return {
    tool: getProviderDisplayName(providerId),
    profile: profile?.name ?? t('sidebar.default'),
  };
}
