import { stripAnsi } from './ansi';
import { appState } from './state.js';

/** Matches a Claude Code separator line containing the conversation title */
const TITLE_RE = /─{3,}\s+(\S[^─]*\S)\s+─{2,}/;

/** Sessions that have already been titled (skip future parsing for performance) */
const titled = new Set<string>();

/** Parse conversation title from raw PTY output and auto-rename the session */
export function parseTitle(sessionId: string, rawData: string): void {
  if (titled.has(sessionId)) return;
  if (!appState.preferences.autoTitleEnabled) return;

  const clean = stripAnsi(rawData);

  // Process line-by-line to avoid matching text spanning across separate separator lines
  for (const line of clean.split(/\r?\n|\r/)) {
    const match = TITLE_RE.exec(line);
    if (!match) continue;

    const title = match[1].trim();
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
