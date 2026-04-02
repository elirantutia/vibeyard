import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./terminal-pane.js', () => ({
  getSearchAddon: vi.fn(),
  getTerminalInstance: vi.fn(),
}));

vi.mock('./project-terminal.js', () => ({
  getShellTerminalInstance: vi.fn(),
}));

class FakeClassList {
  private values = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) this.values.add(token);
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) this.values.delete(token);
  }

  toggle(token: string, force?: boolean): boolean {
    const shouldAdd = force ?? !this.values.has(token);
    if (shouldAdd) this.values.add(token);
    else this.values.delete(token);
    return shouldAdd;
  }

  contains(token: string): boolean {
    return this.values.has(token);
  }

  toString(): string {
    return Array.from(this.values).join(' ');
  }
}

class FakeElement {
  children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  className = '';
  classList = new FakeClassList();
  textContent = '';
  value = '';
  type = '';
  placeholder = '';
  title = '';
  spellcheck = true;
  listeners = new Map<string, Array<(event?: any) => void>>();
  focused = false;
  selected = false;

  constructor(public tagName: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
    this.parentElement = null;
  }

  addEventListener(event: string, cb: (event?: any) => void): void {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(cb);
    this.listeners.set(event, listeners);
  }

  dispatch(event: string, payload: any = {}): void {
    for (const cb of this.listeners.get(event) ?? []) cb(payload);
  }

  focus(): void {
    this.focused = true;
  }

  select(): void {
    this.selected = true;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === 'input') {
      return this.find((child) => child.tagName === 'input');
    }
    if (selector.startsWith('.')) {
      const className = selector.slice(1);
      return this.find((child) => child.className.split(/\s+/).includes(className) || child.classList.contains(className));
    }
    return null;
  }

  private find(predicate: (el: FakeElement) => boolean): FakeElement | null {
    for (const child of this.children) {
      if (predicate(child)) return child;
      const nested = child.find(predicate);
      if (nested) return nested;
    }
    return null;
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName);
  }
}

class FakeBackend {
  private state = { currentIndex: -1, totalCount: 0 };
  private listeners = new Set<(state: { currentIndex: number; totalCount: number }) => void>();
  private lastQuery = '';
  clearCalls = 0;
  focusCalls = 0;

  constructor(private container: FakeElement) {}

  findNext(query: string): void {
    this.lastQuery = query;
    if (query === 'needle') {
      this.state = {
        totalCount: 3,
        currentIndex: this.state.totalCount === 3 && this.lastQuery === query && this.state.currentIndex >= 0
          ? (this.state.currentIndex + 1) % 3
          : 0,
      };
    } else {
      this.state = { currentIndex: -1, totalCount: 0 };
    }
    this.emit();
  }

  findPrevious(query: string): void {
    this.lastQuery = query;
    if (query === 'needle') {
      this.state = {
        totalCount: 3,
        currentIndex: this.state.totalCount === 3 && this.state.currentIndex >= 0
          ? (this.state.currentIndex + 2) % 3
          : 2,
      };
    } else {
      this.state = { currentIndex: -1, totalCount: 0 };
    }
    this.emit();
  }

  clearDecorations(): void {
    this.clearCalls++;
    this.state = { currentIndex: -1, totalCount: 0 };
    this.emit();
  }

  getContainer(): FakeElement {
    return this.container;
  }

  focus(): void {
    this.focusCalls++;
  }

  getResultState() {
    return this.state;
  }

  subscribe(listener: (state: { currentIndex: number; totalCount: number }) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state);
  }
}

describe('search-bar', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('document', new FakeDocument());
  });

  it('shows and updates the match counter while navigating', async () => {
    const { showSearchBar, destroySearchBar } = await import('./search-bar.js');
    const container = new FakeElement('div');
    const backend = new FakeBackend(container);

    showSearchBar('session-1', backend as never);

    const bar = container.children[0]!;
    const input = bar.querySelector('input')!;
    const result = bar.querySelector('.search-result-count')!;

    input.value = 'needle';
    input.dispatch('input');
    expect(result.textContent).toBe('1 of 3');

    input.dispatch('keydown', {
      key: 'Enter',
      shiftKey: false,
      preventDefault() {},
      metaKey: false,
      ctrlKey: false,
    });
    expect(result.textContent).toBe('2 of 3');

    input.dispatch('keydown', {
      key: 'Enter',
      shiftKey: true,
      preventDefault() {},
      metaKey: false,
      ctrlKey: false,
    });
    expect(result.textContent).toBe('1 of 3');

    destroySearchBar('session-1');
  });

  it('shows no results and clears the status when the query is empty', async () => {
    const { showSearchBar, destroySearchBar } = await import('./search-bar.js');
    const container = new FakeElement('div');
    const backend = new FakeBackend(container);

    showSearchBar('session-2', backend as never);

    const bar = container.children[0]!;
    const input = bar.querySelector('input')!;
    const result = bar.querySelector('.search-result-count')!;

    input.value = 'missing';
    input.dispatch('input');
    expect(result.textContent).toBe('No results');

    input.value = '';
    input.dispatch('input');
    expect(result.textContent).toBe('');

    destroySearchBar('session-2');
  });
});
