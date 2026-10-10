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

describe('projectProfileLabel', () => {
  beforeEach(() => {
    vi.resetModules();
    stubDom();
  });

  function makeProfile(id: string, name: string, providerId = 'claude') {
    return { id, name, providerId, configDir: `/cfg/${id}`, managed: true, createdAt: 0 };
  }

  async function load() {
    const sidebar = await import('./sidebar.js');
    const { appState } = await import('../state.js');
    return { projectProfileLabel: sidebar.projectProfileLabel, appState };
  }

  it('returns undefined when zero or one claude profile exists', async () => {
    const { projectProfileLabel, appState } = await load();
    expect(projectProfileLabel({ defaultProfileId: undefined } as any)).toBeUndefined();
    appState.profiles.push(makeProfile('work', 'Work') as any);
    expect(projectProfileLabel({ defaultProfileId: 'work' } as any)).toBeUndefined();
  });

  it('labels a project with no explicit profile as "Default"', async () => {
    const { projectProfileLabel, appState } = await load();
    appState.profiles.push(makeProfile('work', 'Work') as any, makeProfile('home', 'Home') as any);
    appState.preferences.defaultProfileId = undefined;
    expect(projectProfileLabel({ defaultProfileId: undefined } as any)).toBe('Default');
  });

  it('uses the project default profile name when set', async () => {
    const { projectProfileLabel, appState } = await load();
    appState.profiles.push(makeProfile('work', 'Work') as any, makeProfile('home', 'Home') as any);
    expect(projectProfileLabel({ defaultProfileId: 'home' } as any)).toBe('Home');
  });

  it('falls back to the preferences default profile when the project has none', async () => {
    const { projectProfileLabel, appState } = await load();
    appState.profiles.push(makeProfile('work', 'Work') as any, makeProfile('home', 'Home') as any);
    appState.preferences.defaultProfileId = 'work';
    expect(projectProfileLabel({ defaultProfileId: undefined } as any)).toBe('Work');
  });

  it('labels an unknown profile id as "Default"', async () => {
    const { projectProfileLabel, appState } = await load();
    appState.profiles.push(makeProfile('work', 'Work') as any, makeProfile('home', 'Home') as any);
    expect(projectProfileLabel({ defaultProfileId: 'ghost' } as any)).toBe('Default');
  });

  it('ignores non-claude profiles when counting', async () => {
    const { projectProfileLabel, appState } = await load();
    // Two profiles total, but only one targets claude — gate stays closed.
    appState.profiles.push(makeProfile('work', 'Work', 'claude') as any, makeProfile('gem', 'Gem', 'gemini') as any);
    expect(projectProfileLabel({ defaultProfileId: 'work' } as any)).toBeUndefined();
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

  function proj(id: string, lastActivityAt?: number) {
    return { id, lastActivityAt } as any;
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

  it('keeps stored order when sortByActivity is false', async () => {
    const projectRenderOrder = await load();
    const projects = [proj('a', 1), proj('b', 3), proj('c', 2)];
    const plan = projectRenderOrder(projects, null, false);
    expect(plan.map((e) => e.project.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders by lastActivityAt descending when sortByActivity is true', async () => {
    const projectRenderOrder = await load();
    const projects = [proj('a', 1), proj('b', 3), proj('c', 2)];
    const plan = projectRenderOrder(projects, 'a', true);
    expect(plan.map((e) => e.project.id)).toEqual(['b', 'c', 'a']);
    // active flag still tracks the right project after reordering
    expect(plan.find((e) => e.isActive)?.project.id).toBe('a');
  });

  it('treats a missing lastActivityAt as oldest and preserves stored order for ties', async () => {
    const projectRenderOrder = await load();
    // a & c tie (both undefined → 0); stable sort keeps their stored order.
    const projects = [proj('a'), proj('b', 5), proj('c')];
    const plan = projectRenderOrder(projects, null, true);
    expect(plan.map((e) => e.project.id)).toEqual(['b', 'a', 'c']);
  });

  it('does not mutate the input array when sorting', async () => {
    const projectRenderOrder = await load();
    const projects = [proj('a', 1), proj('b', 3)];
    projectRenderOrder(projects, null, true);
    expect(projects.map((p) => p.id)).toEqual(['a', 'b']);
  });
});
