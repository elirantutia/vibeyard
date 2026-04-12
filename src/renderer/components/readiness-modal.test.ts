import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Hoisted mocks ---

const mockProviderAvailability = vi.hoisted(() => ({
  loadProviderMetas: vi.fn(async () => {}),
  loadProviderAvailability: vi.fn(async () => {}),
  getCachedProviderMetas: vi.fn(() => [] as Array<{ id: string; displayName: string }>),
  getProviderAvailabilitySnapshot: vi.fn(() => null as {
    providers: Array<{ id: string; displayName: string }>;
    availability: Map<string, boolean>;
  } | null),
  getAvailableProviderMetas: vi.fn(() => [] as Array<{ id: string; displayName: string }>),
  getProviderDisplayName: vi.fn((id: string) => id),
}));

const mockState = vi.hoisted(() => ({
  activeProject: { id: 'p1', path: '/project' },
  preferences: { readinessExcludedProviders: [] as string[] },
  on: vi.fn(() => () => {}),
  setPreference: vi.fn(),
  addPlanSession: vi.fn(),
}));

vi.mock('../provider-availability.js', () => mockProviderAvailability);
vi.mock('../state.js', () => ({ appState: mockState }));
vi.mock('./modal.js', () => ({ closeModal: vi.fn() }));
vi.mock('../dom-utils.js', () => ({
  esc: (s: string) => s,
  scoreColor: () => '#4caf50',
}));
vi.mock('./terminal-pane.js', () => ({ setPendingPrompt: vi.fn() }));
vi.mock('./tab-bar.js', () => ({ promptNewSession: vi.fn() }));

// --- Minimal DOM stubs ---

function makeElement(): Record<string, unknown> {
  const children: Record<string, unknown>[] = [];
  const el: Record<string, unknown> = {
    className: '',
    textContent: '',
    type: '',
    checked: false,
    title: '',
    disabled: false,
    _children: children,
    _listeners: {} as Record<string, Function[]>,
    appendChild(child: Record<string, unknown>) {
      children.push(child);
      return child;
    },
    querySelector(_sel: string) { return null; },
    remove() {},
    classList: {
      _classes: new Set<string>(),
      add(...cls: string[]) { cls.forEach(c => (this as any)._classes.add(c)); },
      remove(...cls: string[]) { cls.forEach(c => (this as any)._classes.delete(c)); },
      contains(c: string) { return (this as any)._classes.has(c); },
      toggle(c: string, force?: boolean) {
        const has = (this as any)._classes.has(c);
        if (force === undefined) {
          has ? (this as any)._classes.delete(c) : (this as any)._classes.add(c);
        } else if (force) {
          (this as any)._classes.add(c);
        } else {
          (this as any)._classes.delete(c);
        }
      },
    },
    addEventListener(event: string, cb: Function) {
      const listeners = el._listeners as Record<string, Function[]>;
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    removeEventListener() {},
  };
  // Handle innerHTML setter to clear children
  let innerHtmlValue = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return innerHtmlValue; },
    set(v: string) {
      innerHtmlValue = v;
      children.length = 0;
    },
    enumerable: true,
    configurable: true,
  });
  return el;
}

const domElements: Record<string, Record<string, unknown>> = {};

function getOrCreateDomElement(id: string): Record<string, unknown> {
  if (!domElements[id]) domElements[id] = makeElement();
  return domElements[id];
}

vi.stubGlobal('document', {
  getElementById(id: string) { return getOrCreateDomElement(id); },
  createElement(_tag: string) { return makeElement(); },
  createTextNode(text: string) { return { textContent: text }; },
  addEventListener() {},
  removeEventListener() {},
});

// --- Helpers ---

const allProviderMetas = [
  { id: 'claude', displayName: 'Claude Code' },
  { id: 'codex', displayName: 'Codex CLI' },
  { id: 'gemini', displayName: 'Gemini CLI' },
];

const minimalResult = {
  overallScore: 75,
  categories: [],
  scannedAt: new Date().toISOString(),
};

function getModalBodyContainer(): Record<string, unknown> {
  const bodyEl = getOrCreateDomElement('modal-body');
  const children = bodyEl._children as Record<string, unknown>[];
  return children[children.length - 1]; // last appended container
}

function findFilterSection(container: Record<string, unknown>): Record<string, unknown> | undefined {
  const children = container._children as Record<string, unknown>[];
  return children.find(c => c.className === 'readiness-filter-section');
}

function getFilterLabels(filterSection: Record<string, unknown>): Record<string, unknown>[] {
  const children = filterSection._children as Record<string, unknown>[];
  const row = children.find(c => c.className === 'readiness-filter-row');
  const rowChildren = (row?._children ?? []) as Record<string, unknown>[];
  return rowChildren.filter(c => c.className === 'readiness-filter-toggle');
}

// --- Tests ---

describe('readiness-modal provider filter', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockState.preferences.readinessExcludedProviders = [];
    // Reset DOM elements so fresh module imports get clean refs
    for (const key of Object.keys(domElements)) delete domElements[key];
  });

  function setupMocks(availability: Map<string, boolean>): void {
    // getCachedProviderMetas returns ALL registered providers (buggy code path uses this)
    mockProviderAvailability.getCachedProviderMetas.mockReturnValue(allProviderMetas);
    mockProviderAvailability.loadProviderMetas.mockResolvedValue(undefined);

    // getProviderAvailabilitySnapshot returns availability info (fixed code path uses this)
    mockProviderAvailability.loadProviderAvailability.mockResolvedValue(undefined);
    mockProviderAvailability.getProviderAvailabilitySnapshot.mockReturnValue({
      providers: allProviderMetas,
      availability,
    });
    mockProviderAvailability.getAvailableProviderMetas.mockReturnValue(
      allProviderMetas.filter(p => availability.get(p.id)),
    );
  }

  it('does not show provider filter when only one provider is available', async () => {
    setupMocks(new Map([['claude', true], ['codex', false], ['gemini', false]]));

    const { showReadinessModal } = await import('./readiness-modal.js');
    await showReadinessModal(minimalResult as any);

    const container = getModalBodyContainer();
    const filterSection = findFilterSection(container);

    expect(filterSection).toBeUndefined();
  });

  it('shows provider filter only for available providers when multiple are available', async () => {
    setupMocks(new Map([['claude', true], ['codex', true], ['gemini', false]]));

    const { showReadinessModal } = await import('./readiness-modal.js');
    await showReadinessModal(minimalResult as any);

    const container = getModalBodyContainer();
    const filterSection = findFilterSection(container);

    expect(filterSection).toBeDefined();

    const labels = getFilterLabels(filterSection!);
    // Should only have 2 labels (claude + codex), not 3
    expect(labels).toHaveLength(2);
  });

  it('shows all provider filters when all providers are available', async () => {
    setupMocks(new Map([['claude', true], ['codex', true], ['gemini', true]]));

    const { showReadinessModal } = await import('./readiness-modal.js');
    await showReadinessModal(minimalResult as any);

    const container = getModalBodyContainer();
    const filterSection = findFilterSection(container);

    expect(filterSection).toBeDefined();

    const labels = getFilterLabels(filterSection!);
    expect(labels).toHaveLength(3);
  });
});
