import { stripAnsi } from './ansi';
import { appState } from './state.js';

/** Matches a Claude Code separator line containing the conversation title */
const TITLE_RE = /─{3,}\s+(\S[^─]*\S)\s+─{2,}/;

function foldCliBannerText(title: string): string {
  return title
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[\s"'`*_~()[\]{}“”‘’]+|[\s"'`*_~()[\]{}“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Separator text for the CLI welcome header (e.g. "Claude Code v2.1.108"), not a
 * user conversation topic — must not replace tab names via auto-title.
 */
function looksLikeCliProductBanner(title: string): boolean {
  const t = foldCliBannerText(title);
  if (!t.startsWith('claude code')) return false;
  const rest = t.slice('claude code'.length).trim();
  if (!rest) return true;
  return /^v?[\d.]+(?:[a-z0-9.-]*)$/i.test(rest);
}

function titleFromSeparatorLine(line: string): string | null {
  const m = TITLE_RE.exec(line);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;
  if (looksLikeCliProductBanner(raw)) return null;
  return raw;
}

/** Sessions that have already been titled (skip future parsing for performance) */
const titled = new Set<string>();

/** Parse conversation title from raw PTY output and auto-rename the session */
export function parseTitle(sessionId: string, rawData: string): void {
  if (titled.has(sessionId)) return;
  if (!appState.preferences.autoTitleEnabled) return;

  const clean = stripAnsi(rawData);

  // Process line-by-line to avoid matching text spanning across separate separator lines
  for (const line of clean.split(/\r?\n|\r/)) {
    const title = titleFromSeparatorLine(line);
    if (!title) continue;

    titled.add(sessionId);

    // Find the session and check if user renamed it
    for (const project of appState.projects) {
      const session = project.sessions.find((s) => s.id === sessionId);
      if (session) {
        if (!session.userRenamed) {
          appState.renameSession(project.id, sessionId, title);
        }
        return;
      }
    }
    return;
  }
}

/** Clear a session's title tracking so it can be titled again (e.g., after /clear or session exit) */
export function clearSession(sessionId: string): void {
  titled.delete(sessionId);
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  titled.clear();
}
