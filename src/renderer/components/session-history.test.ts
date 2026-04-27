import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAppState = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const state = {
    preferences: { sessionHistoryEnabled: true, sidebarViews: { sessionHistory: true } },
    projects: [] as Array<{ id: string; sessionHistory: unknown[] }>,
    activeProject: {
      id: 'p1',
      sessionHistory: [
        {
          id: 'h1',
          name: 'Codex session',
          providerId: 'codex',
          cliSessionId: 'cli-1',
          createdAt: '2026-03-31T08:00:00.000Z',
          closedAt: '2026-03-31T09:00:00.000Z',
          cost: { totalCostUsd: 0.42, totalInputTokens: 1000, totalOutputTokens: 500, totalDurationMs: 5000 },
        },
      ],
    },
    on: vi.fn((event: string, cb: () => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return () => listeners.get(event)?.delete(cb);
    }),
    getSessionHistory: vi.fn(() => state.activeProject.sessionHistory),
    clearSessionHistory: vi.fn(),
    toggleBookmark: vi.fn(),
    removeHistoryEntry: vi.fn(),
    resumeFromHistory: vi.fn(),
    emit(event: string) {
      listeners.get(event)?.forEach(cb => cb());
    },
    reset() {
      listeners.clear();
      state.preferences.sessionHistoryEnabled = true;
      state.preferences.sidebarViews.sessionHistory = true;
      state.activeProject = {
        id: 'p1',
        sessionHistory: [
          {
            id: 'h1',
            name: 'Codex session',
            providerId: 'codex',
            cliSessionId: 'cli-1',
            createdAt: '2026-03-31T08:00:00.000Z',
            closedAt: '2026-03-31T09:00:00.000Z',
            cost: { totalCostUsd: 0.42, totalInputTokens: 1000, totalOutputTokens: 500, totalDurationMs: 5000 },
          },
        ],
      };
      state.projects = [state.activeProject];
      state.getSessionHistory.mockImplementation(() => state.activeProject.sessionHistory);
      state.clearSessionHistory.mockClear();
      state.toggleBookmark.mockClear();
      state.removeHistoryEntry.mockClear();
      state.resumeFromHistory.mockClear();
      state.on.mockClear();
    },
  };
  state.projects = [state.activeProject];
  return state;
});

vi.mock('../state.js', () => ({
  appState: mockAppState,
}));

vi.mock('../provider-availability.js', () => ({
  loadProviderAvailability: vi.fn(() => Promise.resolve()),
}));

vi.mock('./resume-with-provider-menu.js', () => ({
  buildResumeWithProviderItems: vi.fn(() => []),
}));

class FakeClassList {
  constructor(private owner: FakeElement) {}

  add(...tokens: string[]): void {
    const set = new Set(this.owner.className.split(/\s+/).filter(Boolean));
    for (const token of tokens) set.add(token);
    this.owner.className = Array.from(set).join(' ');
  }

  remove(...tokens: string[]): void {
    const removeSet = new Set(tokens);
    this.owner.className = this.owner.className
      .split(/\s+/)
      .filter(token => token && !removeSet.has(token))
      .join(' ');
  }

  toggle(token: string, force?: boolean): boolean {
    const has = this.contains(token);
    const shouldHave = force ?? !has;
    if (shouldHave) this.add(token);
    else this.remove(token);
    return shouldHave;
  }

  contains(token: string): boolean {
    return this.owner.className.split(/\s+/).includes(token);
  }
}

class FakeElement {
  children: FakeElement[] = [];
  style: Record<string, string> = {};
  className = '';
  textContent = '';
  title = '';
  value = '';
  type = '';
  placeholder = '';
  src = '';
  alt = '';
  onerror: (() => unknown) | null = null;
  parentNode: FakeElement | null = null;
  listeners = new Map<string, Array<() => void>>();
  classList = new FakeClassList(this);

  constructor(public tagName: string, public ownerDocument: FakeDocument) {}

  set innerHTML(value: string) {
    this.textContent = value;
    if (value === '') this.children = [];
  }

  get innerHTML(): string {
    return this.textContent;
  }

  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  addEventListener(event: string, cb: () => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(cb);
    this.listeners.set(event, existing);
  }

  dispatch(event: string): void {
    for (const cb of this.listeners.get(event) ?? []) cb();
  }

  querySelector(selector: string): FakeElement | null {
    if (!selector.startsWith('.')) return null;
    const className = selector.slice(1);
    for (const child of this.children) {
      if (child.classList.contains(className)) return child;
      const nested = child.querySelector(selector);
      if (nested) return nested;
    }
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    const results: FakeElement[] = [];
    if (!selector.startsWith('.')) return results;
    const className = selector.slice(1);
    for (const child of this.children) {
      if (child.classList.contains(className)) results.push(child);
      results.push(...child.querySelectorAll(selector));
    }
    return results;
  }
}

class FakeDocument {
  body: FakeElement;
  private elementsById = new Map<string, FakeElement>();

  constructor() {
    this.body = new FakeElement('body', this);
  }

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  getElementById(id: string): FakeElement {
    let el = this.elementsById.get(id);
    if (!el) {
      el = new FakeElement('div', this);
      this.elementsById.set(id, el);
    }
    return el;
  }

  addEventListener = vi.fn();
}

async function renderHistory(): Promise<FakeElement> {
  vi.resetModules();
  const doc = new FakeDocument();
  const container = doc.createElement('div');
  vi.stubGlobal('document', doc);

  const { renderSessionHistory } = await import('./session-history.js');
  renderSessionHistory(mockAppState.activeProject as never, container as never);
  return container;
}

beforeEach(() => {
  mockAppState.reset();
  vi.unstubAllGlobals();
});

describe('renderSessionHistory', () => {
  it('renders the provider name in the subtitle after the cost', async () => {
    const container = await renderHistory();
    const details = container.querySelector('.history-item-details');

    expect(details).not.toBeNull();
    expect(details?.textContent).toContain('$0.42');
    expect(details?.textContent).toContain('Codex CLI');
    expect(details?.textContent?.indexOf('$0.42')).toBeLessThan(details?.textContent?.indexOf('Codex CLI') ?? -1);
  });

  it('renders the provider name even when cost is missing', async () => {
    mockAppState.activeProject.sessionHistory[0].cost = null;
    const container = await renderHistory();
    const details = container.querySelector('.history-item-details');

    expect(details?.textContent).toContain('Codex CLI');
  });

  it('shows empty state when there is no history', async () => {
    mockAppState.activeProject.sessionHistory = [];
    const container = await renderHistory();
    const empty = container.querySelector('.history-empty');
    expect(empty?.textContent).toBe('No session history yet');
  });

  it('renders search, bookmark filter, and clear buttons', async () => {
    const container = await renderHistory();
    expect(container.querySelector('.history-search')).not.toBeNull();
    expect(container.querySelector('.history-bookmark-filter')).not.toBeNull();
    expect(container.querySelector('.history-clear-btn')).not.toBeNull();
  });
});
