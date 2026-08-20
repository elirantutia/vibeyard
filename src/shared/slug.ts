/** Convert a human-readable name to a kebab-case slug suitable for filenames and slash commands. */
export function nameToSlug(name: string): string {
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || 'agent';
}

/**
 * Slugify Markdown heading text the way in-document `#anchor` links are written.
 *
 * Deliberately NOT `nameToSlug`: that one folds to ASCII and collapses
 * whitespace runs, which is right for filenames but wrong here — anchors keep
 * non-latin characters and emit one dash per whitespace char ('a & b' -> 'a--b'),
 * matching how GitHub-style heading anchors are generated.
 */
export function slugifyHeading(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

/** Append a short hex suffix until the slug is unique within `taken`. */
export function ensureUniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 0; i < 16; i++) {
    const candidate = `${base}-${randomHex(6)}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

function randomHex(len: number): string {
  let out = '';
  while (out.length < len) {
    out += Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  }
  return out.slice(0, len);
}
