import { describe, expect, it, vi } from 'vitest';
import { DomSearchBackend } from './dom-search-backend.js';

class FakeTextElement {
  innerHTML = '';
  constructor(public textContent: string) {}
}

class FakeBodyElement {
  parentElement = {} as HTMLElement;

  constructor(private elements: FakeTextElement[]) {}

  querySelectorAll(selector: string): FakeTextElement[] {
    if (selector === '.line') return this.elements;
    return [];
  }

  querySelector(): null {
    return null;
  }
}

describe('DomSearchBackend', () => {
  it('tracks total matches and current index across next/previous navigation', () => {
    const body = new FakeBodyElement([
      new FakeTextElement('needle here'),
      new FakeTextElement('needle and another needle'),
    ]);
    const backend = new DomSearchBackend(body as unknown as HTMLElement, '.line');

    (backend as any).renderHighlights = vi.fn();
    (backend as any).moveCurrent = vi.fn();

    backend.findNext('needle', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 0, totalCount: 3 });

    backend.findNext('needle', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 1, totalCount: 3 });

    backend.findPrevious('needle', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: 0, totalCount: 3 });
  });

  it('emits no-results and reset state correctly', () => {
    const body = new FakeBodyElement([new FakeTextElement('haystack only')]);
    const backend = new DomSearchBackend(body as unknown as HTMLElement, '.line');
    const states: Array<{ currentIndex: number; totalCount: number }> = [];
    backend.subscribe((state) => states.push(state));

    (backend as any).renderHighlights = vi.fn();
    (backend as any).moveCurrent = vi.fn();

    backend.findNext('needle', { caseSensitive: false, regex: false });
    expect(backend.getResultState()).toEqual({ currentIndex: -1, totalCount: 0 });

    backend.clearDecorations();
    expect(backend.getResultState()).toEqual({ currentIndex: -1, totalCount: 0 });
    expect(states.at(-1)).toEqual({ currentIndex: -1, totalCount: 0 });
  });
});
