import { describe, it, expect, vi } from 'vitest';

vi.mock('../state.js', () => ({ appState: {} }));

import { highlightMatches } from './session-search-palette.js';

describe('highlightMatches', () => {
  it('returns escaped text when query is empty', () => {
    expect(highlightMatches('hello <world>', '')).toBe('hello &lt;world&gt;');
    expect(highlightMatches('plain', '   ')).toBe('plain');
  });

  it('wraps a single-word match (case-insensitive)', () => {
    expect(highlightMatches('Hello world', 'hello'))
      .toBe('<mark class="search-match">Hello</mark> world');
  });

  it('highlights every occurrence of a multi-word query', () => {
    const out = highlightMatches('claude code is fun. claude rocks. just code.', 'claude code');
    expect(out).toBe(
      '<mark class="search-match">claude code</mark> is fun. ' +
      '<mark class="search-match">claude</mark> rocks. just ' +
      '<mark class="search-match">code</mark>.',
    );
  });

  it('treats regex metacharacters as literals', () => {
    expect(highlightMatches('call foo(bar) and foo.bar', 'foo(bar)'))
      .toBe('call <mark class="search-match">foo(bar)</mark> and foo.bar');
    expect(() => highlightMatches('anything', '.*')).not.toThrow();
    expect(highlightMatches('a.*b plain', '.*'))
      .toBe('a<mark class="search-match">.*</mark>b plain');
  });

  it('returns just the escaped text when nothing matches', () => {
    expect(highlightMatches('nothing here & <ok>', 'zzz'))
      .toBe('nothing here &amp; &lt;ok&gt;');
  });

  it('escapes HTML in both matched and unmatched segments', () => {
    expect(highlightMatches('<script>alert("x")</script>', 'script'))
      .toBe('&lt;<mark class="search-match">script</mark>&gt;alert(&quot;x&quot;)&lt;/<mark class="search-match">script</mark>&gt;');
  });
});
