import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLoad = vi.fn();
const mockSave = vi.fn();
const mockProvision = vi.fn(async (id: string) => ({ configDir: `/cfg/${id}`, managed: true }));

vi.stubGlobal('window', {
  vibeyard: {
    store: { load: mockLoad, save: mockSave },
    profiles: { provision: mockProvision },
  },
});

let uuidCounter = 0;
vi.stubGlobal('crypto', {
  randomUUID: () => `uuid-${++uuidCounter}`,
});

vi.mock('../session-cost.js', () => ({
  getCost: vi.fn().mockReturnValue(null),
  restoreCost: vi.fn(),
}));

vi.mock('../session-context.js', () => ({
  restoreContext: vi.fn(),
}));

vi.mock('../provider-availability.js', () => {
  const mockMetas = vi.fn(() => []);
  return {
    getProviderCapabilities: vi.fn(() => null),
    getProviderAvailabilitySnapshot: vi.fn(() => null),
    getTeamChatProviderMetas: mockMetas,
    // Derives from the same mocked metas so tests keep controlling capability
    // through mockGetTeamChatProviderMetas.mockReturnValue(...).
    getTeamCapableProviderIds: vi.fn(() => new Set((mockMetas() ?? []).map((m: { id: string }) => m.id))),
  };
});

import { appState, _resetForTesting } from '../state';
import { getTeamChatProviderMetas } from '../provider-availability.js';
const mockGetTeamChatProviderMetas = vi.mocked(getTeamChatProviderMetas);
import { getCost } from '../session-cost.js';
const mockGetCost = vi.mocked(getCost);

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  mockGetCost.mockReturnValue(null);
  _resetForTesting();
});

function addProject(name = 'Test', path = '/test') {
  return appState.addProject(name, path);
}

describe('startTeamChat()', () => {
  function makeMember(): import('../../shared/types.js').TeamMember {
    return {
      id: 'm-1',
      name: 'CMO',
      role: 'Marketing',
      systemPrompt: 'You are the CMO.',
      source: 'custom',
      createdAt: 0,
      updatedAt: 0,
    };
  }

  function metaFor(id: 'claude' | 'codex' | 'gemini' | 'copilot') {
    return {
      id,
      displayName: id,
      binaryName: id,
      capabilities: {
        sessionResume: true,
        costTracking: false,
        contextWindow: false,
        hookStatus: true,
        configReading: true,
        shiftEnterNewline: false,
        pendingPromptTrigger: 'startup-arg' as const,
        systemPromptInjection: id === 'claude' || id === 'codex',
      },
      defaultContextWindowSize: 200_000,
    };
  }

  it('falls through Gemini override to Claude when Claude is team-capable', () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude'), metaFor('codex')]);
    const project = addProject();
    const session = appState.startTeamChat(project.id, makeMember(), 'gemini');
    expect(session?.providerId).toBe('claude');
    expect(session?.pendingSystemPrompt).toBe('You are the CMO.');
  });

  it('falls through Copilot default-provider to Claude', () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude'), metaFor('codex')]);
    appState.setPreference('defaultProvider', 'copilot');
    const project = addProject();
    const session = appState.startTeamChat(project.id, makeMember());
    expect(session?.providerId).toBe('claude');
  });

  it('honors a Codex override when team-capable', () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude'), metaFor('codex')]);
    const project = addProject();
    const session = appState.startTeamChat(project.id, makeMember(), 'codex');
    expect(session?.providerId).toBe('codex');
  });

  it('returns undefined and creates no session when no team-capable provider exists', () => {
    mockGetTeamChatProviderMetas.mockReturnValue([]);
    const project = addProject();
    const before = project.sessions.length;
    const session = appState.startTeamChat(project.id, makeMember(), 'gemini');
    expect(session).toBeUndefined();
    expect(appState.projects.find((p) => p.id === project.id)?.sessions.length).toBe(before);
  });

  it('numbers sessions per team member', () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude')]);
    const project = addProject();
    const cmo = makeMember();
    const ceo: import('../../shared/types.js').TeamMember = {
      ...makeMember(),
      id: 'm-2',
      name: 'CEO',
    };

    expect(appState.startTeamChat(project.id, cmo)?.name).toBe('CMO - Session 1');
    expect(appState.startTeamChat(project.id, cmo)?.name).toBe('CMO - Session 2');
    expect(appState.startTeamChat(project.id, ceo)?.name).toBe('CEO - Session 1');
    expect(appState.startTeamChat(project.id, cmo)?.name).toBe('CMO - Session 3');
  });
});

describe('startTeamChat() with a pinned member profile', () => {
  function makeMember(profileId?: string): import('../../shared/types.js').TeamMember {
    return {
      id: 'm-1',
      name: 'Architect',
      role: 'Design',
      systemPrompt: 'You are the Architect.',
      source: 'custom',
      createdAt: 0,
      updatedAt: 0,
      profileId,
    };
  }

  function metaFor(id: 'claude' | 'codex') {
    return {
      id,
      displayName: id,
      binaryName: id,
      capabilities: {
        sessionResume: true,
        costTracking: false,
        contextWindow: false,
        hookStatus: true,
        configReading: true,
        shiftEnterNewline: false,
        pendingPromptTrigger: 'startup-arg' as const,
        systemPromptInjection: true,
      },
      defaultContextWindowSize: 200_000,
    };
  }

  it('runs on the pinned profile provider and pins the profile on the session', async () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude'), metaFor('codex')]);
    const project = addProject();
    const codexProfile = await appState.addProfile({ name: 'Codex Work', providerId: 'codex' });

    const session = appState.startTeamChat(project.id, makeMember(codexProfile.id))!;
    // Provider comes *from* the pin, overriding the claude default.
    expect(session.providerId).toBe('codex');
    expect(session.profileId).toBe(codexProfile.id);
    expect(session.pendingSystemPrompt).toBe('You are the Architect.');
  });

  it('the pin wins over the project and global default profiles', async () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude'), metaFor('codex')]);
    const project = addProject();
    const claudeProfile = await appState.addProfile({ name: 'Claude Home', providerId: 'claude' });
    const codexProfile = await appState.addProfile({ name: 'Codex Work', providerId: 'codex' });
    appState.setProjectDefaultProfile(project.id, claudeProfile.id);
    appState.setProviderDefaultProfile('claude', claudeProfile.id);

    const session = appState.startTeamChat(project.id, makeMember(codexProfile.id))!;
    expect(session.providerId).toBe('codex');
    expect(session.profileId).toBe(codexProfile.id);
  });

  it('an unpinned member still falls back to the project default profile', async () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude')]);
    const project = addProject();
    const claudeProfile = await appState.addProfile({ name: 'Claude Home', providerId: 'claude' });
    appState.setProjectDefaultProfile(project.id, claudeProfile.id);

    const session = appState.startTeamChat(project.id, makeMember())!;
    expect(session.providerId).toBe('claude');
    expect(session.profileId).toBe(claudeProfile.id);
  });

  it('a pin whose provider is not team-capable falls back to the normal provider pick', async () => {
    // Only claude is team-capable; the member is pinned to a codex profile.
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude')]);
    const project = addProject();
    const codexProfile = await appState.addProfile({ name: 'Codex Work', providerId: 'codex' });

    const session = appState.startTeamChat(project.id, makeMember(codexProfile.id))!;
    expect(session.providerId).toBe('claude');
    // The codex pin must not leak onto a claude session.
    expect(session.profileId).toBeUndefined();
  });

  it('a pin pointing at a deleted profile falls back to the chain', async () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude')]);
    const project = addProject();
    const claudeProfile = await appState.addProfile({ name: 'Claude Home', providerId: 'claude' });
    appState.setProjectDefaultProfile(project.id, claudeProfile.id);
    appState.removeProfile(claudeProfile.id);

    const session = appState.startTeamChat(project.id, makeMember(claudeProfile.id))!;
    expect(session.providerId).toBe('claude');
    expect(session.profileId).toBeUndefined();
  });

  it('a pinned member ignores the provider override', async () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude'), metaFor('codex')]);
    const project = addProject();
    const codexProfile = await appState.addProfile({ name: 'Codex Work', providerId: 'codex' });

    const session = appState.startTeamChat(project.id, makeMember(codexProfile.id), 'claude')!;
    // The pin wins outright: the override must not redirect a pinned member.
    expect(session.providerId).toBe('codex');
    expect(session.profileId).toBe(codexProfile.id);
  });

  it('a dangling pin falls back to a surviving project default profile', async () => {
    mockGetTeamChatProviderMetas.mockReturnValue([metaFor('claude')]);
    const project = addProject();
    const deletedProfile = await appState.addProfile({ name: 'Claude Old', providerId: 'claude' });
    const survivingProfile = await appState.addProfile({ name: 'Claude New', providerId: 'claude' });
    appState.setProjectDefaultProfile(project.id, survivingProfile.id);
    appState.removeProfile(deletedProfile.id);

    const session = appState.startTeamChat(project.id, makeMember(deletedProfile.id))!;
    expect(session.providerId).toBe('claude');
    // The fallback chain is actually consulted: the surviving project default wins.
    expect(session.profileId).toBe(survivingProfile.id);
  });
});

describe('removeProfile clears member pins', () => {
  it('unpins members pointing at the deleted profile', async () => {
    const profile = await appState.addProfile({ name: 'Work', providerId: 'claude' });
    const member = appState.addTeamMember({
      name: 'Dev',
      role: 'Engineering',
      systemPrompt: 'code',
      source: 'custom',
      profileId: profile.id,
    });
    expect(member.profileId).toBe(profile.id);

    appState.removeProfile(profile.id);
    expect(appState.getTeamMembers().find((m) => m.id === member.id)?.profileId).toBeUndefined();
  });
});

describe('updateTeamMember unpin', () => {
  it('clears the pin when the patch sends an explicit undefined profileId', async () => {
    const profile = await appState.addProfile({ name: 'Work', providerId: 'claude' });
    const member = appState.addTeamMember({
      name: 'Dev',
      role: 'Engineering',
      systemPrompt: 'code',
      source: 'custom',
      profileId: profile.id,
    });
    expect(member.profileId).toBe(profile.id);

    // The member modal's "Default" option sends an explicit `profileId: undefined`.
    appState.updateTeamMember(member.id, { profileId: undefined });
    expect(appState.getTeamMembers().find((m) => m.id === member.id)?.profileId).toBeUndefined();
  });
});
