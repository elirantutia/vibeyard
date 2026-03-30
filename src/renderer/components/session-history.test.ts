import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockAppState = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>();
  const state = {
    preferences: { sessionHistoryEnabled: true, sidebarViews: { sessionHistory: true } },
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
      state.getSessionHistory.mockImplementation(() => state.activeProject.sessionHistory);
      state.clearSessionHistory.mockClear();
      state.toggleBookmark.mockClear();
      state.removeHistoryEntry.mockClear();
      state.resumeFromHistory.mockClear();
      state.on.mockClear();
    },
  };
  return state;
});

vi.mock('../state.js', () => ({
  appState: mockAppState,
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
}

class FakeDocument {
  private elements = new Map<string, FakeElement>();

  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }

  getElementById(id: string): FakeElement | null {
    return this.elements.get(id) ?? null;
  }

  registerElement(id: string, element: FakeElement): void {
    this.elements.set(id, element);
  }
}

async function renderHistory(): Promise<FakeElement> {
  vi.resetModules();
  const document = new FakeDocument();
  const container = document.createElement('div');
  document.registerElement('session-history', container);
  vi.stubGlobal('document', document);

  const { initSessionHistory } = await import('./session-history.js');
  initSessionHistory();

  container.children[0]?.dispatch('click');
  return container;
}

beforeEach(() => {
  mockAppState.reset();
  vi.unstubAllGlobals();
});

describe('initSessionHistory', () => {
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
});
