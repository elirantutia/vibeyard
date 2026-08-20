import { isAbsolutePath, resolveRelativePath } from '../shared/platform.js';
import { slugifyHeading } from '../shared/slug.js';
import { isHttpUrl } from '../shared/url.js';

/**
 * Where a link inside rendered Markdown should go. Anything we cannot route
 * safely resolves to `ignore` — rendered content must never be able to navigate
 * the app document itself.
 */
export type MarkdownLinkTarget =
  | { kind: 'anchor'; slug: string }
  | { kind: 'external'; url: string }
  | { kind: 'file'; path: string }
  | { kind: 'ignore' };

const IGNORE: MarkdownLinkTarget = { kind: 'ignore' };
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Malformed percent-escapes ('%zz') throw — fall back to the raw text.
    return value;
  }
}

export function resolveMarkdownLink(href: string, baseDir?: string): MarkdownLinkTarget {
  const trimmed = href.trim();
  if (!trimmed) return IGNORE;

  if (trimmed.startsWith('#')) {
    const slug = slugifyHeading(decode(trimmed.slice(1)));
    return slug ? { kind: 'anchor', slug } : IGNORE;
  }

  // Protocol-relative ('//host/path') would be fetched over the page protocol.
  if (trimmed.startsWith('//')) return IGNORE;

  // Checked before the scheme test: a Windows drive letter ('C:\...') would
  // otherwise read as a URL scheme.
  if (!isAbsolutePath(trimmed) && HAS_SCHEME.test(trimmed)) {
    // Only http(s) is routable — `app:openExternal` rejects every other scheme,
    // and `javascript:`/`file:` must never be followed.
    return isHttpUrl(trimmed) ? { kind: 'external', url: trimmed } : IGNORE;
  }

  const pathOnly = decode(trimmed.split(/[?#]/)[0]);
  if (!pathOnly) return IGNORE;

  // Gate absolute paths on `baseDir` too. Callers that render Markdown from an
  // untrusted origin (the predefined-persona picker fetches it over the network)
  // pass no base, and must not be able to open '/Users/me/.claude.json' — a path
  // the main process's read allowlist happily permits.
  if (!baseDir) return IGNORE;
  if (isAbsolutePath(pathOnly)) return { kind: 'file', path: pathOnly };
  return { kind: 'file', path: resolveRelativePath(baseDir, pathOnly) };
}
