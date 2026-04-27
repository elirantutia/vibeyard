import type { SearchBackend, SearchResultState } from './search-bar.js';

interface MatchInfo {
  element: HTMLElement;
  startOffset: number;
  length: number;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class DomSearchBackend implements SearchBackend {
  private matches: MatchInfo[] = [];
  private currentIndex = -1;
  private lastQuery = '';
  private lastOptions = { caseSensitive: false, regex: false };
  private originals = new Map<HTMLElement, string>();
  private highlighted = false;
  private listeners = new Set<(state: SearchResultState) => void>();

  constructor(
    private body: HTMLElement,
    private textSelector: string,
  ) {}

  findNext(query: string, options: { caseSensitive: boolean; regex: boolean }): void {
    const changed = this.search(query, options);
    if (this.matches.length === 0) {
      this.emitResultState();
      return;
    }
    this.currentIndex = (this.currentIndex + 1) % this.matches.length;
    if (changed) {
      this.renderHighlights();
    } else {
      this.moveCurrent();
    }
    this.emitResultState();
  }

  findPrevious(query: string, options: { caseSensitive: boolean; regex: boolean }): void {
    const changed = this.search(query, options);
    if (this.matches.length === 0) {
      this.emitResultState();
      return;
    }
    this.currentIndex = (this.currentIndex - 1 + this.matches.length) % this.matches.length;
    if (changed) {
      this.renderHighlights();
    } else {
      this.moveCurrent();
    }
    this.emitResultState();
  }

  clearDecorations(): void {
    this.restoreOriginals();
    this.matches = [];
    this.currentIndex = -1;
    this.lastQuery = '';
    this.highlighted = false;
    this.emitResultState();
  }

  getContainer(): HTMLElement {
    return this.body.parentElement!;
  }

  focus(): void {
    // No specific element to refocus for file panes
  }

  getResultState(): SearchResultState {
    return {
      currentIndex: this.currentIndex,
      totalCount: this.matches.length,
    };
  }

  subscribe(listener: (state: SearchResultState) => void): () => void {
    this.listeners.add(listener);
    listener(this.getResultState());
    return () => this.listeners.delete(listener);
  }

  private restoreOriginals(): void {
    for (const [el, html] of this.originals) {
      el.innerHTML = html;
    }
    this.originals.clear();
  }

  /** Returns true if matches were recalculated, false if cached. */
  private search(query: string, options: { caseSensitive: boolean; regex: boolean }): boolean {
    if (query === this.lastQuery && options.caseSensitive === this.lastOptions.caseSensitive && options.regex === this.lastOptions.regex) {
      return false;
    }

    this.restoreOriginals();
    this.matches = [];
    this.currentIndex = -1;
    this.highlighted = false;
    this.lastQuery = query;
    this.lastOptions = { ...options };

    if (!query) return true;

    let pattern: RegExp;
    try {
      const flags = options.caseSensitive ? 'g' : 'gi';
      pattern = options.regex ? new RegExp(query, flags) : new RegExp(escapeRegExp(query), flags);
    } catch {
      return true;
    }

    const elements = this.body.querySelectorAll(this.textSelector);
    for (const el of elements) {
      const htmlEl = el as HTMLElement;
      const text = htmlEl.textContent || '';
      let match: RegExpExecArray | null;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(text)) !== null) {
        this.matches.push({ element: htmlEl, startOffset: match.index, length: match[0].length });
        if (match[0].length === 0) {
          pattern.lastIndex++;
        }
      }
    }
    return true;
  }

  /** Full render of all match highlights. Called once when search query changes. */
  private renderHighlights(): void {
    this.restoreOriginals();

    const byElement = new Map<HTMLElement, MatchInfo[]>();
    for (const m of this.matches) {
      let arr = byElement.get(m.element);
      if (!arr) {
        arr = [];
        byElement.set(m.element, arr);
      }
      arr.push(m);
    }

    for (const [el, elMatches] of byElement) {
      this.originals.set(el, el.innerHTML);

      const text = el.textContent || '';
      elMatches.sort((a, b) => a.startOffset - b.startOffset);

      let html = '';
      let pos = 0;
      for (const m of elMatches) {
        html += escapeHtml(text.slice(pos, m.startOffset));
        const isCurrent = this.matches[this.currentIndex] === m;
        const cls = isCurrent ? 'search-match search-match-current' : 'search-match';
        html += `<mark class="${cls}">${escapeHtml(text.slice(m.startOffset, m.startOffset + m.length))}</mark>`;
        pos = m.startOffset + m.length;
      }
      html += escapeHtml(text.slice(pos));
      if (!html) html = '&nbsp;';
      el.innerHTML = html;
    }

    this.highlighted = true;
    this.scrollToCurrent();
  }

  /** O(1) navigation: swap current-match class between marks. */
  private moveCurrent(): void {
    if (!this.highlighted) {
      this.renderHighlights();
      return;
    }

    // Remove current from previous
    const prev = this.body.querySelector('.search-match-current');
    if (prev) prev.classList.remove('search-match-current');

    // Find the new current mark by counting
    const marks = this.body.querySelectorAll('.search-match');
    const target = marks[this.currentIndex] as HTMLElement | undefined;
    if (target) {
      target.classList.add('search-match-current');
    }

    this.scrollToCurrent();
  }

  private scrollToCurrent(): void {
    const current = this.body.querySelector('.search-match-current') as HTMLElement | null;
    if (current) {
      current.scrollIntoView({ block: 'nearest' });
    }
  }

  private emitResultState(): void {
    const state = this.getResultState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
