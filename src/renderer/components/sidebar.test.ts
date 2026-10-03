import { beforeEach, describe, expect, it, vi } from 'vitest';

// sidebar.ts grabs a handful of DOM nodes at module load and pulls in a wide
// import graph; stub just enough of the browser globals so the module imports
// in the node test environment. We only exercise the pure profile-label helper.
class FakeElement {
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  classList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
  dataset: Record<string, string> = {};
  appendChild(c: FakeElement) { this.children.push(c); return c; }
  addEventListener() {}
  removeEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  setAttribute() {}
  getBoundingClientRect() { return { top: 0, height: 0 }; }
  focus() {}
  remove() {}
}

function stubDom() {
  const doc = {
    getElementById: () => new FakeElement(),
    createElement: () => new FakeElement(),
    addEventListener: () => {},
    body: new FakeElement(),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { vibeyard: {} });
}

// Capability table matching the real provider registry: claude, pi and omp
// are profile-capable, the rest are not.
vi.mock('../provider-availability.js', () => ({
  loadProviderMetas: vi.fn(async () => {}),
  loadProviderAvailability: vi.fn(async () => {}),
  hasMultipleAvailableProviders: vi.fn(() => false),
  getProviderAvailabilitySnapshot: vi.fn(() => null),
  getCachedProviderMetas: vi.fn(() => []),
  getAvailableProviderMetas: vi.fn(() => []),
  getTeamChatProviderMetas: vi.fn(() => []),
  getTeamCapableProviderIds: vi.fn(() => new Set()),
  getProviderCapabilities: vi.fn((id: string) => ({
    profiles: id === 'claude' || id === 'pi' || id === 'omp',
  })),
  getProviderDisplayName: vi.fn((id: string) => {
    const names: Record<string, string> = { claude: 'Claude Code', pi: 'Pi', omp: 'Oh my Pi' };
    return names[id] ?? id;
  }),
}));

describe('projectProfileBadge', () => {
  beforeEach(() => {
    vi.resetModules();
    stubDom();
  });

  function makeProfile(id: string, name: string, providerId = 'claude') {
    return { id, name, providerId, configDir: `/cfg/${id}`, managed: true, createdAt: 0 };
  }

  async function load() {
    const { projectProfileBadge } = await import('../profile-utils.js');
    const { appState } = await import('../state.js');
    return { projectProfileBadge, appState };
  }

  function seedTwoTools(appState: any) {
    appState.preferences.defaultProvider = 'claude';
    appState.profiles.push(
      makeProfile('work', 'Work', 'claude') as any,
      makeProfile('alt', 'Alt', 'claude') as any,
      makeProfile('home', 'Home', 'pi') as any,
    );
  }

  function makeProject(overrides: Record<string, unknown> = {}) {
    return { sessions: [], activeSessionId: null, ...overrides } as any;
  }

  it('hides the badge until more than one profile-capable profile exists', async () => {
    const { projectProfileBadge, appState } = await load();
    expect(projectProfileBadge(makeProject())).toBeUndefined();
    appState.profiles.push(makeProfile('work', 'Work') as any);
    expect(projectProfileBadge(makeProject({ defaultProfileId: 'work' }))).toBeUndefined();
  });

  it('hides the badge when the current tool has no profile concept', async () => {
    const { projectProfileBadge, appState } = await load();
    seedTwoTools(appState);
    appState.preferences.defaultProvider = 'gemini';
    expect(projectProfileBadge(makeProject({ defaultProfileId: 'work' }))).toBeUndefined();
  });

  it('pairs the tool with "Default" when nothing pins a profile', async () => {
    const { projectProfileBadge, appState } = await load();
    seedTwoTools(appState);
    appState.preferences.defaultProfiles = undefined;
    expect(projectProfileBadge(makeProject())).toEqual({ tool: 'Claude Code', profile: 'Default' });
  });

  it('applies the current tool\'s global default when the project has no pin', async () => {
    const { projectProfileBadge, appState } = await load();
    seedTwoTools(appState);
    appState.preferences.defaultProfiles = { claude: 'work' };
    expect(projectProfileBadge(makeProject({ defaultProfileId: undefined }))).toEqual({
      tool: 'Claude Code',
      profile: 'Work',
    });
  });

  it('outranks the tool default with the project pin', async () => {
    const { projectProfileBadge, appState } = await load();
    seedTwoTools(appState);
    appState.preferences.defaultProfiles = { claude: 'work' };
    // 'alt' is a Claude profile, so it survives the provider match and wins
    // over the tool's own default.
    expect(projectProfileBadge(makeProject({ defaultProfileId: 'alt' }))).toEqual({
      tool: 'Claude Code',
      profile: 'Alt',
    });
  });

  it('never shows a profile belonging to a different coding tool', async () => {
    const { projectProfileBadge, appState } = await load();
    seedTwoTools(appState);
    appState.preferences.defaultProfiles = {};
    // 'home' is a Pi profile while the project's tool is Claude: the stale pin
    // must not label the card "Home".
    expect(projectProfileBadge(makeProject({ defaultProfileId: 'home' }))).toEqual({
      tool: 'Claude Code',
      profile: 'Default',
    });
  });

  it('follows the active session\'s tool, not the project pin\'s tool', async () => {
    const { projectProfileBadge, appState } = await load();
    seedTwoTools(appState);
    appState.preferences.defaultProfiles = { pi: 'home' };
    const project = makeProject({
      sessions: [{ id: 's1', providerId: 'pi' }],
      activeSessionId: 's1',
      defaultProfileId: 'work',
    });
    expect(projectProfileBadge(project)).toEqual({ tool: 'Pi', profile: 'Default' });
  });

  it('labels an unknown profile id as "Default"', async () => {
    const { projectProfileBadge, appState } = await load();
    seedTwoTools(appState);
    expect(projectProfileBadge(makeProject({ defaultProfileId: 'ghost' }))).toEqual({
      tool: 'Claude Code',
      profile: 'Default',
    });
  });
});

describe('profile-utils', () => {
  beforeEach(() => {
    vi.resetModules();
    stubDom();
  });

  function makeProfile(id: string, name: string, providerId = 'claude') {
    return { id, name, providerId, configDir: `/cfg/${id}`, managed: true, createdAt: 0 };
  }

  it('scopes profile options to a single coding tool with bare names', async () => {
    const { providerProfileOptions } = await import('../profile-utils.js');
    const { appState } = await import('../state.js');
    appState.profiles.push(
      makeProfile('work', 'Work', 'claude') as any,
      makeProfile('home', 'Home', 'pi') as any,
      makeProfile('omp1', 'OMP Work', 'omp') as any,
      makeProfile('gem', 'Gem', 'gemini') as any,
    );
    expect(providerProfileOptions('claude')).toEqual([{ value: 'work', label: 'Work' }]);
    expect(providerProfileOptions('pi')).toEqual([{ value: 'home', label: 'Home' }]);
    expect(providerProfileOptions('omp')).toEqual([{ value: 'omp1', label: 'OMP Work' }]);
    expect(providerProfileOptions('gemini')).toEqual([]);
  });

  it('resolves the project provider from the active session, else the global default', async () => {
    const { projectProviderId } = await import('../profile-utils.js');
    const { appState } = await import('../state.js');
    appState.preferences.defaultProvider = 'claude';
    expect(projectProviderId({ sessions: [], activeSessionId: null } as any)).toBe('claude');
    expect(projectProviderId({ sessions: [{ id: 's1', providerId: 'omp' }], activeSessionId: 's1' } as any)).toBe('omp');
    expect(projectProviderId({ sessions: [{ id: 's1', providerId: 'omp' }], activeSessionId: 's2' } as any)).toBe('claude');
  });

  it('returns only profile-capable profiles', async () => {
    const { profileCapableProfiles } = await import('../profile-utils.js');
    const { appState } = await import('../state.js');
    appState.profiles.push(
      makeProfile('work', 'Work', 'claude') as any,
      makeProfile('home', 'Home', 'pi') as any,
      makeProfile('gem', 'Gem', 'gemini') as any,
    );
    expect(profileCapableProfiles().map((p) => p.id)).toEqual(['work', 'home']);
  });
});

describe('projectRenderOrder', () => {
  beforeEach(() => {
    vi.resetModules();
    stubDom();
  });

  async function load() {
    const sidebar = await import('./sidebar.js');
    return sidebar.projectRenderOrder;
  }

  function proj(id: string) {
    return { id } as any;
  }

  it('preserves project order — the active project is not pinned to the top', async () => {
    const projectRenderOrder = await load();
    const projects = [proj('a'), proj('b'), proj('c')];
    const plan = projectRenderOrder(projects, 'c');
    expect(plan.map((e) => e.project.id)).toEqual(['a', 'b', 'c']);
    expect(plan.map((e) => e.isActive)).toEqual([false, false, true]);
  });

  it('flags exactly the active project in place', async () => {
    const projectRenderOrder = await load();
    const plan = projectRenderOrder([proj('a'), proj('b'), proj('c')], 'b');
    expect(plan.map((e) => e.project.id)).toEqual(['a', 'b', 'c']);
    expect(plan.find((e) => e.isActive)?.project.id).toBe('b');
    expect(plan.filter((e) => e.isActive)).toHaveLength(1);
  });

  it('marks nothing active when activeProjectId is null or unknown', async () => {
    const projectRenderOrder = await load();
    expect(projectRenderOrder([proj('a'), proj('b')], null).some((e) => e.isActive)).toBe(false);
    expect(projectRenderOrder([proj('a'), proj('b')], 'ghost').some((e) => e.isActive)).toBe(false);
  });

  it('returns an empty plan for no projects', async () => {
    const projectRenderOrder = await load();
    expect(projectRenderOrder([], null)).toEqual([]);
  });
});
