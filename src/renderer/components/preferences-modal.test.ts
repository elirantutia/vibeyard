import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
    preferences: {
      soundOnSessionWaiting: true,
      notificationsDesktop: true,
      debugMode: false,
      sessionHistoryEnabled: true,
      insightsEnabled: true,
      autoTitleEnabled: true,
      confirmCloseWorkingSession: true,
      theme: 'dark' as 'dark' | 'light',
      defaultProvider: 'claude',
      sidebarViews: {
        gitPanel: true,
        sessionHistory: true,
        costFooter: true,
        discussions: true,
        fileTree: true,
      },
      availableActions: {
        sessionIndicators: true,
        usageStats: true,
        terminal: true,
        mcp: true,
        swarmMode: true,
        newSession: true,
        browserTab: true,
        remoteSession: true,
      },
    },
  on: vi.fn(() => () => {}),
  setPreference: vi.fn(),
}));

const selectState = vi.hoisted(() => {
  const instances = new Map<string, {
    value: string;
    element: Record<string, unknown>;
    setValue: (value: string) => void;
    getValue: () => string;
    destroyCount: number;
    destroy: () => void;
  }>();
  return {
    instances,
    reset() {
      instances.clear();
    },
  };
});

vi.mock('../state.js', () => ({ appState: mockState }));
vi.mock('./modal.js', () => ({ closeModal: vi.fn() }));
vi.mock('../zoom.js', () => ({
  applyZoom: vi.fn(),
  getZoomFactor: vi.fn(() => 1),
  ZOOM_STEPS: [1, 1.25, 1.5],
}));
vi.mock('../shortcuts.js', () => ({
  shortcutManager: {
    getAll: vi.fn(() => new Map()),
    hasOverride: vi.fn(() => false),
    getKeys: vi.fn(() => []),
    setOverride: vi.fn(),
    resetOverride: vi.fn(),
  },
  displayKeys: vi.fn(() => ''),
  eventToAccelerator: vi.fn(() => null),
}));
vi.mock('../provider-availability.js', () => ({
  loadProviderAvailability: vi.fn(async () => {}),
  getProviderAvailabilitySnapshot: vi.fn(() => ({
    providers: [{ id: 'claude', displayName: 'Claude Code' }],
    availability: new Map([['claude', true]]),
  })),
}));
vi.mock('./setup-checks.js', () => ({
  hasProviderIssue: vi.fn(() => false),
}));
vi.mock('./custom-select.js', () => ({
  createCustomSelect: vi.fn((id: string, _options: Array<{ value: string; label: string }>, initialValue: string, onChange?: (value: string) => void) => {
    const element = makeElement('div');
    element.className = 'custom-select';
    element.dataset.selectId = id;
    let value = initialValue;
      const instance = {
        value,
        element,
        setValue(nextValue: string) {
          value = nextValue;
        instance.value = nextValue;
        onChange?.(nextValue);
      },
        getValue() {
          return value;
        },
        destroyCount: 0,
        destroy() {
          instance.destroyCount += 1;
        },
      };
      selectState.instances.set(id, instance);
      return instance;
    }),
}));

type ListenerMap = Record<string, Array<(...args: unknown[]) => void>>;

function makeElement(tagName = 'div'): Record<string, any> {
  const children: Record<string, any>[] = [];
  const listeners: ListenerMap = {};
  const classValues = new Set<string>();
  const element: Record<string, any> = {
    tagName,
    children,
    dataset: {},
    style: {},
    className: '',
    textContent: '',
    value: '',
    checked: false,
    type: '',
    id: '',
    parentElement: null,
    appendChild(child: Record<string, any>) {
      child.parentElement = element;
      children.push(child);
      return child;
    },
    remove() {
      if (!element.parentElement) return;
      const siblings = element.parentElement.children as Record<string, any>[];
      element.parentElement.children = siblings.filter((child) => child !== element);
      element.parentElement = null;
    },
    querySelector(selector: string) {
      if (!selector.startsWith('.')) return null;
      const targetClass = selector.slice(1);
      return findInTree(element, (node) => node.className?.split(/\s+/).includes(targetClass));
    },
    closest(selector: string) {
      if (!selector.startsWith('.')) return null;
      const targetClass = selector.slice(1);
      let current: Record<string, any> | null = element;
      while (current) {
        if (current.className?.split(/\s+/).includes(targetClass)) return current;
        current = current.parentElement;
      }
      return null;
    },
    addEventListener(event: string, cb: (...args: unknown[]) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    },
    removeEventListener(event: string, cb: (...args: unknown[]) => void) {
      listeners[event] = (listeners[event] ?? []).filter((listener) => listener !== cb);
    },
    dispatchEvent(event: { type: string }) {
      for (const listener of listeners[event.type] ?? []) listener(event);
    },
    classList: {
      add(...tokens: string[]) { tokens.forEach((token) => classValues.add(token)); },
      remove(...tokens: string[]) { tokens.forEach((token) => classValues.delete(token)); },
      toggle(token: string, force?: boolean) {
        const shouldAdd = force ?? !classValues.has(token);
        if (shouldAdd) classValues.add(token);
        else classValues.delete(token);
      },
      contains(token: string) { return classValues.has(token); },
    },
  };

  Object.defineProperty(element, 'innerHTML', {
    get() { return ''; },
    set(_value: string) {
      children.length = 0;
    },
    configurable: true,
  });

  return element;
}

function findInTree(root: Record<string, any>, predicate: (node: Record<string, any>) => boolean): Record<string, any> | null {
  for (const child of root.children as Record<string, any>[]) {
    if (predicate(child)) return child;
    const nested = findInTree(child, predicate);
    if (nested) return nested;
  }
  return null;
}

const domElements: Record<string, Record<string, any>> = {};

function getOrCreateElement(id: string): Record<string, any> {
  if (!domElements[id]) domElements[id] = makeElement();
  return domElements[id];
}

function click(el: Record<string, any>): void {
  el.dispatchEvent({ type: 'click' });
}

function selectPreferencesSection(section: string): void {
  const body = getOrCreateElement('modal-body');
  const menu = findInTree(body, (node) => node.className === 'preferences-menu');
  if (!menu) throw new Error('preferences menu not found');
  const item = (menu.children as Record<string, any>[]).find((c) => c.dataset?.section === section);
  if (!item) throw new Error(`menu item not found for section: ${section}`);
  menu.dispatchEvent({ type: 'click', target: item });
}

describe('showPreferencesModal theme preference', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    selectState.reset();
    for (const key of Object.keys(domElements)) delete domElements[key];

    mockState.preferences.theme = 'dark';

    vi.stubGlobal('document', {
      documentElement: { dataset: {} as Record<string, string> },
      getElementById(id: string) { return getOrCreateElement(id); },
      createElement(tagName: string) { return makeElement(tagName); },
      createTextNode(text: string) { return { textContent: text }; },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    vi.stubGlobal('window', {
      vibeyard: {
        provider: {
          listProviders: vi.fn(async () => []),
          checkBinary: vi.fn(async () => true),
        },
        settings: {
          validate: vi.fn(async () => ({ statusLine: 'missing', hooks: 'missing', hookDetails: {} })),
          reinstall: vi.fn(async () => {}),
        },
        menu: { rebuild: vi.fn() },
        app: { getVersion: vi.fn(async () => '0.0.0'), openExternal: vi.fn() },
        update: {
          checkNow: vi.fn(async () => {}),
          onAvailable: vi.fn(() => () => {}),
          onError: vi.fn(() => () => {}),
        },
      },
    });
  });

  it('uses the persisted theme value for the theme select', async () => {
    mockState.preferences.theme = 'light';
    const { showPreferencesModal } = await import('./preferences-modal.js');

    showPreferencesModal();
    selectPreferencesSection('appearance');

    expect(selectState.instances.get('pref-theme')?.getValue()).toBe('light');
  });

  it('previews and saves the selected theme', async () => {
    const { showPreferencesModal } = await import('./preferences-modal.js');

    showPreferencesModal();
    selectPreferencesSection('appearance');

    const themeSelect = selectState.instances.get('pref-theme')!;
    themeSelect.setValue('light');

    expect((document as any).documentElement.dataset.theme).toBe('light');

    click(getOrCreateElement('modal-confirm'));

    expect(mockState.setPreference).toHaveBeenCalledWith('theme', 'light');
  });

  it('restores the original theme on cancel', async () => {
    const { showPreferencesModal } = await import('./preferences-modal.js');

    (document as any).documentElement.dataset.theme = 'dark';
    showPreferencesModal();
    selectPreferencesSection('appearance');

    const themeSelect = selectState.instances.get('pref-theme')!;
    themeSelect.setValue('light');
    click(getOrCreateElement('modal-cancel'));

    expect((document as any).documentElement.dataset.theme).toBe('dark');
    expect(mockState.setPreference).not.toHaveBeenCalledWith('theme', 'light');
  });

  it('destroys each select once during cleanup', async () => {
    const { showPreferencesModal } = await import('./preferences-modal.js');

    showPreferencesModal();
    selectPreferencesSection('appearance');

    (getOrCreateElement('modal-overlay') as any)._cleanup();

    expect(selectState.instances.get('pref-theme')?.destroyCount).toBe(1);
    expect(selectState.instances.get('pref-zoom')?.destroyCount).toBe(1);
  });

  it('saves available action visibility toggles', async () => {
    const { showPreferencesModal } = await import('./preferences-modal.js');

    showPreferencesModal();
    selectPreferencesSection('appearance');

    const body = getOrCreateElement('modal-body');
    const usageCheckbox = findInTree(body, (node) => node.id === 'pref-available-action-usageStats');
    const remoteCheckbox = findInTree(body, (node) => node.id === 'pref-available-action-remoteSession');

    usageCheckbox.checked = false;
    remoteCheckbox.checked = false;

    click(getOrCreateElement('modal-confirm'));

    expect(mockState.setPreference).toHaveBeenCalledWith('availableActions', {
      sessionIndicators: true,
      usageStats: false,
      terminal: true,
      mcp: true,
      swarmMode: true,
      newSession: true,
      browserTab: true,
      remoteSession: false,
    });
  });
});
