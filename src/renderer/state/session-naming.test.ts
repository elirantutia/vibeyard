import { describe, it, expect, beforeEach } from 'vitest';
import type { ProjectRecord, SessionRecord, ArchivedSession } from '../../shared/types';
import { setLocale, _resetForTesting as resetI18n } from '../i18n';
import { defaultSessionName, nextNumberFor, nextSessionNumber, parseNumberedName, MCP_INSPECTOR_NAME_KEY, DEFAULT_NAME_KEY } from './session-naming';

beforeEach(() => {
  resetI18n();
});

function project(names: string[], historyNames: string[] = []): ProjectRecord {
  return {
    sessions: names.map((name, i) => ({ id: `s${i}`, name }) as SessionRecord),
    sessionHistory: historyNames.map((name, i) => ({ id: `h${i}`, name }) as ArchivedSession),
  } as ProjectRecord;
}

describe('parseNumberedName', () => {
  it('reads the number out of an English default name', () => {
    expect(parseNumberedName(DEFAULT_NAME_KEY, 'Session 7')).toBe(7);
  });

  it('reads the number out of a non-active locale default name', () => {
    // A user who switched language keeps tabs named in the old locale.
    expect(parseNumberedName(DEFAULT_NAME_KEY, '会话 4')).toBe(4);
  });

  it('still recognises English names after switching locale', () => {
    setLocale('zh-CN');
    expect(parseNumberedName(DEFAULT_NAME_KEY, 'Session 7')).toBe(7);
    expect(parseNumberedName(DEFAULT_NAME_KEY, '会话 4')).toBe(4);
  });

  it('returns null for a user-chosen name', () => {
    expect(parseNumberedName(DEFAULT_NAME_KEY, 'Fix the flaky test')).toBeNull();
    expect(parseNumberedName(DEFAULT_NAME_KEY, 'Session')).toBeNull();
    expect(parseNumberedName(DEFAULT_NAME_KEY, 'My Session 3')).toBeNull();
    expect(parseNumberedName(DEFAULT_NAME_KEY, 'Session 3 revisited')).toBeNull();
  });

  it('does not match a different template sharing the prefix', () => {
    expect(parseNumberedName(DEFAULT_NAME_KEY, 'Inspector 2')).toBeNull();
  });
});

describe('nextSessionNumber', () => {
  it('starts at 1 for an empty project', () => {
    expect(nextSessionNumber(project([]))).toBe(1);
  });

  it('continues past the highest existing number', () => {
    expect(nextSessionNumber(project(['Session 1', 'Session 2']))).toBe(3);
  });

  it('does not reuse a number after a middle tab is closed', () => {
    // The bug in `sessions.length + 1`: two tabs left, but "Session 3" is taken.
    expect(nextSessionNumber(project(['Session 1', 'Session 3']))).toBe(4);
  });

  it('ignores user-renamed tabs when counting', () => {
    expect(nextSessionNumber(project(['Fix the bug', 'Session 2']))).toBe(3);
  });

  it('accounts for archived sessions', () => {
    expect(nextSessionNumber(project(['Session 1'], ['Session 9']))).toBe(10);
  });

  it('accounts for names created under another locale', () => {
    expect(nextSessionNumber(project(['Session 1', '会话 5']))).toBe(6);
  });

  it('counts per i18n key, so different tab kinds do not collide', () => {
    // Inspector tabs number independently of session tabs.
    const p = project(['Session 3', 'Inspector 1']);
    expect(nextNumberFor(MCP_INSPECTOR_NAME_KEY, p)).toBe(2);
    expect(nextSessionNumber(p)).toBe(4);
  });

  it('tolerates a missing sessionHistory', () => {
    const p = { sessions: [] } as unknown as ProjectRecord;
    expect(nextSessionNumber(p)).toBe(1);
  });
});

describe('defaultSessionName', () => {
  it('produces the full localized name', () => {
    expect(defaultSessionName(project(['Session 1']))).toBe('Session 2');
  });

  it('follows the active locale', () => {
    setLocale('zh-CN');
    expect(defaultSessionName(project([]))).toBe('会话 1');
  });
});
