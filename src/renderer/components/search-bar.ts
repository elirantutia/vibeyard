import { SearchAddon } from '@xterm/addon-search';
import { Terminal } from '@xterm/xterm';
import { getSearchAddon, getTerminalInstance } from './terminal-pane.js';
import { getShellTerminalInstance } from './project-terminal.js';

export interface SearchResultState {
  currentIndex: number;
  totalCount: number;
}

export interface SearchBackend {
  findNext(query: string, options: { caseSensitive: boolean; regex: boolean }): void;
  findPrevious(query: string, options: { caseSensitive: boolean; regex: boolean }): void;
  clearDecorations(): void;
  getContainer(): HTMLElement;
  focus(): void;
  getResultState(): SearchResultState;
  subscribe(listener: (state: SearchResultState) => void): () => void;
}

interface TerminalLike {
  element: HTMLElement;
  terminal: Terminal;
  searchAddon: SearchAddon;
}

type InstanceResolver = (sessionId: string) => TerminalLike | undefined;

export class XtermSearchBackend implements SearchBackend {
  private resultState: SearchResultState = { currentIndex: -1, totalCount: 0 };
  private listeners = new Set<(state: SearchResultState) => void>();
  private disposeSearchResultsListener: (() => void) | null = null;

  constructor(private sessionId: string, private resolve: InstanceResolver) {}

  findNext(query: string, options: { caseSensitive: boolean; regex: boolean }): void {
    this.ensureSubscription();
    this.resolve(this.sessionId)?.searchAddon.findNext(query, this.getSearchOptions(options));
  }

  findPrevious(query: string, options: { caseSensitive: boolean; regex: boolean }): void {
    this.ensureSubscription();
    this.resolve(this.sessionId)?.searchAddon.findPrevious(query, this.getSearchOptions(options));
  }

  clearDecorations(): void {
    this.resolve(this.sessionId)?.searchAddon.clearDecorations();
    this.updateResultState({ currentIndex: -1, totalCount: 0 });
  }

  getContainer(): HTMLElement {
    return this.resolve(this.sessionId)!.element;
  }

  focus(): void {
    this.resolve(this.sessionId)?.terminal.focus();
  }

  getResultState(): SearchResultState {
    return this.resultState;
  }

  subscribe(listener: (state: SearchResultState) => void): () => void {
    this.ensureSubscription();
    this.listeners.add(listener);
    listener(this.resultState);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.disposeSearchResultsListener?.();
        this.disposeSearchResultsListener = null;
      }
    };
  }

  private ensureSubscription(): void {
    if (this.disposeSearchResultsListener) return;
    const instance = this.resolve(this.sessionId);
    const disposer = instance?.searchAddon.onDidChangeResults((event) => {
      this.updateResultState({ currentIndex: event.resultIndex, totalCount: event.resultCount });
    });
    this.disposeSearchResultsListener = () => disposer?.dispose();
  }

  private getSearchOptions(options: { caseSensitive: boolean; regex: boolean }) {
    return {
      ...options,
      decorations: {
        matchBackground: 'rgba(255, 200, 0, 0.3)',
        activeMatchBackground: 'rgba(255, 200, 0, 0.6)',
        matchBorder: 'rgba(255, 200, 0, 0.45)',
        activeMatchBorder: 'rgba(255, 200, 0, 0.8)',
        matchOverviewRuler: 'rgba(255, 200, 0, 0.45)',
        activeMatchColorOverviewRuler: 'rgba(255, 200, 0, 0.8)',
      },
    };
  }

  private updateResultState(state: SearchResultState): void {
    this.resultState = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export function TerminalSearchBackend(sessionId: string): XtermSearchBackend {
  return new XtermSearchBackend(sessionId, (id) => {
    const instance = getTerminalInstance(id);
    if (!instance) return undefined;
    const searchAddon = getSearchAddon(id);
    if (!searchAddon) return undefined;
    return { element: instance.element, terminal: instance.terminal, searchAddon };
  });
}

export function ShellTerminalSearchBackend(sessionId: string): XtermSearchBackend {
  return new XtermSearchBackend(sessionId, (id) => getShellTerminalInstance(id));
}

const searchBars = new Map<string, { bar: HTMLDivElement; backend: SearchBackend; unsubscribe: () => void }>();

export function showSearchBar(sessionId: string, backend: SearchBackend): void {
  const existing = searchBars.get(sessionId);
  if (existing) {
    existing.unsubscribe();
    existing.backend = backend;
    existing.bar.classList.remove('hidden');
    const input = existing.bar.querySelector('input') as HTMLInputElement;
    const resultCount = existing.bar.querySelector('.search-result-count') as HTMLSpanElement;
    existing.unsubscribe = backend.subscribe((state) => {
      resultCount.textContent = formatSearchResultText(input.value, state);
      resultCount.classList.toggle('empty', input.value !== '' && state.totalCount === 0);
    });
    input.focus();
    input.select();
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'search-bar';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search...';
  input.spellcheck = false;

  const resultCount = document.createElement('span');
  resultCount.className = 'search-result-count';

  const matchCaseBtn = document.createElement('button');
  matchCaseBtn.className = 'search-toggle-btn';
  matchCaseBtn.textContent = 'Aa';
  matchCaseBtn.title = 'Match Case';

  const regexBtn = document.createElement('button');
  regexBtn.className = 'search-toggle-btn';
  regexBtn.textContent = '.*';
  regexBtn.title = 'Use Regular Expression';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'search-nav-btn';
  prevBtn.textContent = '\u2191';
  prevBtn.title = 'Previous Match (Shift+Enter)';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'search-nav-btn';
  nextBtn.textContent = '\u2193';
  nextBtn.title = 'Next Match (Enter)';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-nav-btn search-close-btn';
  closeBtn.textContent = '\u2715';
  closeBtn.title = 'Close (Escape)';

  bar.appendChild(input);
  bar.appendChild(resultCount);
  bar.appendChild(matchCaseBtn);
  bar.appendChild(regexBtn);
  bar.appendChild(prevBtn);
  bar.appendChild(nextBtn);
  bar.appendChild(closeBtn);

  backend.getContainer().appendChild(bar);
  let caseSensitive = false;
  let regex = false;

  function getOptions() {
    return { caseSensitive, regex };
  }

  function renderResultState(state: SearchResultState) {
    resultCount.textContent = formatSearchResultText(input.value, state);
    resultCount.classList.toggle('empty', input.value !== '' && state.totalCount === 0);
  }

  const unsubscribe = backend.subscribe(renderResultState);
  searchBars.set(sessionId, { bar, backend, unsubscribe });

  function doSearch() {
    if (!input.value) {
      backend.clearDecorations();
      renderResultState(backend.getResultState());
      return;
    }
    backend.findNext(input.value, getOptions());
  }

  input.addEventListener('input', doSearch);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!input.value) return;
      if (e.shiftKey) {
        backend.findPrevious(input.value, getOptions());
      } else {
        backend.findNext(input.value, getOptions());
      }
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideSearchBar(sessionId);
    }
    // Prevent Cmd+F from bubbling when search bar is focused
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      input.select();
    }
  });

  matchCaseBtn.addEventListener('click', () => {
    caseSensitive = !caseSensitive;
    matchCaseBtn.classList.toggle('active', caseSensitive);
    doSearch();
  });

  regexBtn.addEventListener('click', () => {
    regex = !regex;
    regexBtn.classList.toggle('active', regex);
    doSearch();
  });

  prevBtn.addEventListener('click', () => {
    if (input.value) backend.findPrevious(input.value, getOptions());
  });

  nextBtn.addEventListener('click', () => {
    if (input.value) backend.findNext(input.value, getOptions());
  });

  closeBtn.addEventListener('click', () => hideSearchBar(sessionId));

  input.focus();
}

export function hideSearchBar(sessionId: string): void {
  const entry = searchBars.get(sessionId);
  if (!entry) return;
  entry.bar.classList.add('hidden');
  entry.backend.clearDecorations();
  entry.backend.focus();
}

export function destroySearchBar(sessionId: string): void {
  const entry = searchBars.get(sessionId);
  if (!entry) return;
  entry.unsubscribe();
  entry.backend.clearDecorations();
  entry.bar.remove();
  searchBars.delete(sessionId);
}

export function isSearchBarVisible(sessionId: string): boolean {
  const entry = searchBars.get(sessionId);
  return !!entry && !entry.bar.classList.contains('hidden');
}

export function formatSearchResultText(query: string, state: SearchResultState): string {
  if (!query) return '';
  if (state.totalCount === 0) return 'No results';
  return `${Math.max(state.currentIndex + 1, 1)} of ${state.totalCount}`;
}
