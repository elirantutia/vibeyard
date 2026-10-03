// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

// R-02 regression: the palette maps sessions by composite identity
// (provider + profile + cliSessionId), so copied histories in two profiles
// and cross-provider id collisions each resolve to their own tab/archive.
const history: Record<string, any[]> = {};
const appState = {
  projects: [
    {
      id: 'project',
      path: '/repo',
      sessions: [
        { id: 'tab-one', cliSessionId: 'same-id', providerId: 'claude', profileId: 'one', name: 'One' },
        { id: 'tab-two', cliSessionId: 'same-id', providerId: 'claude', profileId: 'two', name: 'Two' },
        { id: 'tab-shared', cliSessionId: 'cross-id', providerId: 'claude', name: 'Shared' },
        { id: 'tab-shared-2', cliSessionId: 'cross-id', providerId: 'codex', name: 'Shared Codex' },
      ],
    },
  ],
  getSessionHistory: (projectId: string) => history[projectId] ?? [],
};
vi.mock('../state.js', () => ({ appState }));
vi.mock('../provider-availability.js', () => ({ getProviderDisplayName: (id: string) => id }));
vi.mock('./dom-search-backend.js', () => ({ escapeHtml: (s: string) => s, escapeRegExp: (s: string) => s }));
vi.mock('../../shared/project-name.js', () => ({ deriveProjectName: (p: string) => p }));

const { _buildSessionMapForTesting, sessionIdentityKey } = await import('./session-search-palette.js');

describe('session identity map', () => {
  it('maps two tabs sharing a cliSessionId to their own profiles', () => {
    const map = _buildSessionMapForTesting();
    const one = map.get(sessionIdentityKey('claude', 'one', 'same-id'));
    const two = map.get(sessionIdentityKey('claude', 'two', 'same-id'));
    expect(one?.activeSessionId).toBe('tab-one');
    expect(two?.activeSessionId).toBe('tab-two');
    expect(map.size).toBe(4);
  });

  it('keeps cross-provider id collisions separate', () => {
    const map = _buildSessionMapForTesting();
    const claude = map.get(sessionIdentityKey('claude', undefined, 'cross-id'));
    const codex = map.get(sessionIdentityKey('codex', undefined, 'cross-id'));
    expect(claude?.activeSessionId).toBe('tab-shared');
    expect(codex?.activeSessionId).toBe('tab-shared-2');
  });

  it('maps archived sessions by composite identity without shadowing active tabs', () => {
    history['project'] = [
      { id: 'arch-one', cliSessionId: 'same-id', providerId: 'claude', profileId: 'one', name: 'Arch One' },
      { id: 'arch-two', cliSessionId: 'same-id', providerId: 'claude', profileId: 'two', name: 'Arch Two' },
    ];
    const map = _buildSessionMapForTesting();
    expect(map.get(sessionIdentityKey('claude', 'one', 'same-id'))?.activeSessionId).toBe('tab-one');
    expect(map.get(sessionIdentityKey('claude', 'two', 'same-id'))?.activeSessionId).toBe('tab-two');

    history['project'] = [
      { id: 'arch-three', cliSessionId: 'arch-id', providerId: 'claude', profileId: 'one', name: 'A' },
      { id: 'arch-four', cliSessionId: 'arch-id', providerId: 'claude', profileId: 'two', name: 'B' },
    ];
    const map2 = _buildSessionMapForTesting();
    expect(map2.get(sessionIdentityKey('claude', 'one', 'arch-id'))?.archivedId).toBe('arch-three');
    expect(map2.get(sessionIdentityKey('claude', 'two', 'arch-id'))?.archivedId).toBe('arch-four');
  });
});
