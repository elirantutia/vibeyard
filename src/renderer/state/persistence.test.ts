import { describe, it, expect, vi } from 'vitest';

vi.mock('../session-cost.js', () => ({ restoreCost: vi.fn() }));
vi.mock('../session-context.js', () => ({ restoreContext: vi.fn() }));

import { serializeForSave, hydrateLoadedState } from './persistence.js';
import type { PersistedState, Preferences, SessionRecord } from '../../shared/types.js';

function baseState(session: Partial<SessionRecord>): PersistedState {
  return {
    version: 1,
    activeProjectId: 'p1',
    preferences: {} as PersistedState['preferences'],
    projects: [
      {
        id: 'p1',
        name: 'Proj',
        path: '/p',
        activeSessionId: 's1',
        layout: { mode: 'tabs', splitPanes: [], splitDirection: 'horizontal' },
        sessions: [{ id: 's1', name: 'S', cliSessionId: null, createdAt: '0', ...session }],
      },
    ],
  };
}

describe('serializeForSave', () => {
  it('preserves the sticky profileId on sessions (resume must reuse the config dir)', () => {
    const out = serializeForSave(baseState({ profileId: 'work' }));
    expect(out.projects[0].sessions[0].profileId).toBe('work');
  });

  it('strips the transient pending prompts', () => {
    const out = serializeForSave(baseState({ profileId: 'work', pendingInitialPrompt: 'hi', pendingSystemPrompt: 'sys' }));
    const s = out.projects[0].sessions[0];
    expect(s.profileId).toBe('work');
    expect(s.pendingInitialPrompt).toBeUndefined();
    expect(s.pendingSystemPrompt).toBeUndefined();
  });

  it('passes the top-level profiles array through unchanged', () => {
    const state = baseState({});
    state.profiles = [{ id: 'work', name: 'Work', providerId: 'claude', configDir: '/cfg/work', managed: true, createdAt: 0 }];
    const out = serializeForSave(state);
    expect(out.profiles).toEqual(state.profiles);
  });
});

describe('hydrateLoadedState', () => {
  it('migrates the legacy global defaultProfileId to the provider global default', () => {
    const state = baseState({});
    state.profiles = [{ id: 'work', name: 'Work', providerId: 'pi', configDir: '/cfg/work', managed: true, createdAt: 0 }];
    (state.preferences as { defaultProfileId?: string }).defaultProfileId = 'work';

    hydrateLoadedState(state, {} as Preferences);

    expect(state.preferences.defaultProfiles).toEqual({ pi: 'work' });
    expect((state.preferences as { defaultProfileId?: string }).defaultProfileId).toBeUndefined();
  });

  it('drops a dangling legacy defaultProfileId', () => {
    const state = baseState({});
    (state.preferences as { defaultProfileId?: string }).defaultProfileId = 'gone';

    hydrateLoadedState(state, {} as Preferences);

    expect(state.preferences.defaultProfiles).toBeUndefined();
    expect((state.preferences as { defaultProfileId?: string }).defaultProfileId).toBeUndefined();
  });
});
