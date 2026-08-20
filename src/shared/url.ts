/**
 * True for `http:`/`https:` URLs — the only schemes the app ever hands to the
 * OS browser. Scheme matching is case-insensitive because link text in rendered
 * content is author-controlled ('HTTP://…'), unlike the already-normalized URLs
 * Chromium reports to navigation handlers.
 */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
