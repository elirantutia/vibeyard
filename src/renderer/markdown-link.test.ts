import { describe, it, expect } from 'vitest';
import { resolveMarkdownLink } from './markdown-link';

const BASE = '/repo/docs';

describe('resolveMarkdownLink', () => {
  it('ignores empty and whitespace-only hrefs', () => {
    expect(resolveMarkdownLink('', BASE)).toEqual({ kind: 'ignore' });
    expect(resolveMarkdownLink('   ', BASE)).toEqual({ kind: 'ignore' });
  });

  it('routes in-document anchors', () => {
    expect(resolveMarkdownLink('#Delivery', BASE)).toEqual({ kind: 'anchor', slug: 'delivery' });
    expect(resolveMarkdownLink('#notification-types', BASE)).toEqual({ kind: 'anchor', slug: 'notification-types' });
  });

  it('ignores a bare hash with no slug', () => {
    expect(resolveMarkdownLink('#', BASE)).toEqual({ kind: 'ignore' });
  });

  it('routes http(s) links externally', () => {
    expect(resolveMarkdownLink('https://example.com/a', BASE)).toEqual({ kind: 'external', url: 'https://example.com/a' });
    expect(resolveMarkdownLink('HTTP://example.com', BASE)).toEqual({ kind: 'external', url: 'HTTP://example.com' });
  });

  it('ignores every non-http scheme', () => {
    for (const href of ['mailto:a@b.com', 'javascript:alert(1)', 'file:///etc/hosts', 'vscode://open', 'data:text/html,x']) {
      expect(resolveMarkdownLink(href, BASE)).toEqual({ kind: 'ignore' });
    }
  });

  it('ignores protocol-relative URLs', () => {
    expect(resolveMarkdownLink('//evil.com/x', BASE)).toEqual({ kind: 'ignore' });
  });

  it('resolves relative file links against the base dir', () => {
    expect(resolveMarkdownLink('sibling.md', BASE)).toEqual({ kind: 'file', path: '/repo/docs/sibling.md' });
    expect(resolveMarkdownLink('./sibling.md', BASE)).toEqual({ kind: 'file', path: '/repo/docs/sibling.md' });
    expect(resolveMarkdownLink('../up/doc.md', BASE)).toEqual({ kind: 'file', path: '/repo/up/doc.md' });
    expect(resolveMarkdownLink('sub/dir/f.md', BASE)).toEqual({ kind: 'file', path: '/repo/docs/sub/dir/f.md' });
  });

  it('strips fragments and query strings from file links', () => {
    expect(resolveMarkdownLink('doc.md#section', BASE)).toEqual({ kind: 'file', path: '/repo/docs/doc.md' });
    expect(resolveMarkdownLink('doc.md?v=1', BASE)).toEqual({ kind: 'file', path: '/repo/docs/doc.md' });
  });

  it('passes absolute paths through when a base dir is known', () => {
    expect(resolveMarkdownLink('/abs/path.md', BASE)).toEqual({ kind: 'file', path: '/abs/path.md' });
    expect(resolveMarkdownLink('C:\\abs\\path.md', BASE)).toEqual({ kind: 'file', path: 'C:\\abs\\path.md' });
  });

  it('ignores every file link when there is no base dir', () => {
    expect(resolveMarkdownLink('sibling.md')).toEqual({ kind: 'ignore' });
    expect(resolveMarkdownLink('../up.md')).toEqual({ kind: 'ignore' });
    // Callers rendering untrusted Markdown pass no base; an absolute path must
    // not become a reader tab for e.g. '~/.claude.json'.
    expect(resolveMarkdownLink('/abs/path.md')).toEqual({ kind: 'ignore' });
    expect(resolveMarkdownLink('C:\\abs\\path.md')).toEqual({ kind: 'ignore' });
  });

  it('percent-decodes file links', () => {
    expect(resolveMarkdownLink('my%20doc.md', BASE)).toEqual({ kind: 'file', path: '/repo/docs/my doc.md' });
    expect(resolveMarkdownLink('%E2%9C%93.md', BASE)).toEqual({ kind: 'file', path: '/repo/docs/✓.md' });
  });

  it('falls back to the raw text on malformed percent escapes', () => {
    expect(resolveMarkdownLink('%zz.md', BASE)).toEqual({ kind: 'file', path: '/repo/docs/%zz.md' });
  });
});
