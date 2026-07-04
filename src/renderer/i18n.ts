// Lightweight i18n module for Vibeyard's renderer UI.
//
// Resources are statically imported (no runtime network). v1 supports
// English + Simplified Chinese; the architecture leaves room for
// additional locales by adding entries to SUPPORTED_LOCALES + dropping
// another JSON file. Lookup uses dot-path keys; missing keys fall back
// to English, then warn and return the key itself so the UI degrades
// gracefully during incremental translation.

import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import type { Locale } from '../shared/types.js';

export const SUPPORTED_LOCALES: readonly Locale[] = ['en', 'zh-CN'] as const;

const RESOURCES: Record<Locale, unknown> = {
  en,
  'zh-CN': zhCN,
};

let currentLocale: Locale = 'en';
const listeners = new Set<() => void>();
const warnedKeys = new Set<string>();

/** Walk a dot-path (`a.b.c`) through a nested-object resource. */
function lookup(obj: unknown, path: string[]): string | undefined {
  let cur: unknown = obj;
  for (const segment of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return typeof cur === 'string' ? cur : undefined;
}

function lookupByKey(key: string, locale: Locale): string | undefined {
  return lookup(RESOURCES[locale], key.split('.'));
}

/**
 * Translate a dot-path key under the current locale. Falls back to
 * English when the key is missing in the active locale; warns and
 * returns the key itself when also missing in English. Optional
 * `vars` substitutes `{name}` placeholders in the resolved string
 * (positional placeholders are not supported — v1 only does named).
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const direct = lookupByKey(key, currentLocale);
  if (direct !== undefined) return interpolate(direct, vars);
  if (currentLocale !== 'en') {
    const fallback = lookupByKey(key, 'en');
    if (fallback !== undefined) return interpolate(fallback, vars);
  }
  if (!warnedKeys.has(key)) {
    warnedKeys.add(key);
    console.warn('[i18n] missing key:', key);
  }
  return key;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    return name in vars ? String(vars[name]) : match;
  });
}

export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Switch the active locale. Unknown locales are ignored with a warning.
 * Callers (typically the renderer entry listening to `preferences-changed`)
 * are responsible for persisting the choice on `appState.preferences.locale`.
 */
export function setLocale(locale: Locale): void {
  if (!SUPPORTED_LOCALES.includes(locale)) {
    console.warn('[i18n] unknown locale:', locale);
    return;
  }
  if (locale === currentLocale) return;
  currentLocale = locale;
  for (const fn of listeners) fn();
}

/**
 * Subscribe to locale changes. Returns an unsubscribe handle.
 */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** @internal Test-only: reset all module state. */
export function _resetForTesting(): void {
  currentLocale = 'en';
  listeners.clear();
  warnedKeys.clear();
}
