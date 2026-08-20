import type { ProjectRecord } from '../../shared/types.js';
import { escapeRegExp } from '../../shared/regex.js';
import { allTranslations, t } from '../i18n.js';

/** i18n key for the auto-generated tab name (`Session {num}` / `会话 {num}`). */
export const DEFAULT_NAME_KEY = 'tab.newSession.defaultName';
/** i18n key for the auto-generated MCP inspector tab name. */
export const MCP_INSPECTOR_NAME_KEY = 'tab.newMcpInspector.defaultName';

/** `Session {num}` → `/^Session (\d+)$/`, or null if the template has no `{num}`. */
function toPattern(template: string): RegExp | null {
  const parts = template.split('{num}');
  if (parts.length !== 2) return null;
  return new RegExp(`^${escapeRegExp(parts[0])}(\\d+)${escapeRegExp(parts[1])}$`);
}

const patternCache = new Map<string, RegExp[]>();

/**
 * One anchored pattern per locale's template for `key`.
 *
 * Every locale is matched, not just the active one: a user who switches
 * language keeps their old `Session 3` tabs, and those still have to be
 * recognised as auto-generated so the counter doesn't hand out a duplicate.
 */
function patternsFor(key: string): RegExp[] {
  let patterns = patternCache.get(key);
  if (!patterns) {
    patterns = allTranslations(key).map(toPattern).filter((p): p is RegExp => p !== null);
    patternCache.set(key, patterns);
  }
  return patterns;
}

/** The number in an auto-generated name for `key`, or null if it isn't one. */
export function parseNumberedName(key: string, name: string): number | null {
  for (const pattern of patternsFor(key)) {
    const match = pattern.exec(name);
    if (match) return parseInt(match[1], 10);
  }
  return null;
}

/**
 * Next free number for an auto-generated name under `key`.
 *
 * Counting existing names rather than `sessions.length + 1` is what keeps the
 * numbering unique: closing a middle tab and opening a new one would otherwise
 * hand out a number that is already on screen.
 */
export function nextNumberFor(key: string, project: ProjectRecord): number {
  let max = 0;
  for (const { name } of [...project.sessions, ...(project.sessionHistory ?? [])]) {
    max = Math.max(max, parseNumberedName(key, name) ?? 0);
  }
  return max + 1;
}

/** Next free `Session {num}`. Exposed for the New Session dialog's placeholder. */
export function nextSessionNumber(project: ProjectRecord): number {
  return nextNumberFor(DEFAULT_NAME_KEY, project);
}

/** The full default name for a new session, e.g. `Session 4`. */
export function defaultSessionName(project: ProjectRecord): string {
  return t(DEFAULT_NAME_KEY, { num: nextSessionNumber(project) });
}
