import type { Locale } from '../shared/types.js';

/**
 * Resolve a Vibeyard locale from the browser's `navigator.language`. Any
 * `zh*` value (e.g. `zh-CN`, `zh-Hans-CN`, `zh-Hant-TW`) maps to
 * Simplified Chinese; everything else falls back to English. Missing or
 * empty input is treated as "no preference" and returns English.
 *
 * v1 deliberately collapses the entire `zh*` family to `zh-CN` because we
 * only ship a Simplified Chinese resource. Future Traditional Chinese
 * support can branch here without touching callers.
 */
export function resolveSystemLocale(navLang: string | undefined): Locale {
  if (!navLang) return 'en';
  return /^zh/i.test(navLang) ? 'zh-CN' : 'en';
}
