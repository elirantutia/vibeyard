import { appState, MAX_SESSION_NAME_LENGTH } from './state.js';

/**
 * Adopt the CLI's own session name as the tab title.
 *
 * The name comes from Claude's statusLine payload or Codex's session index.
 *
 * `cliSessionId` is the conversation the title belongs to. It matters because
 * the status file survives a `/clear` until the next statusLine render deletes
 * it, and `resyncAllSessions` re-reads every file on window activate — without
 * this check that stale title would re-name the freshly reset tab.
 */
export function applyCliSessionName(sessionId: string, name: string, cliSessionId?: string): void {
  if (!appState.preferences.autoTitleEnabled) return;

  const title = name.trim();
  if (!title) return;

  const found = appState.findSessionWithProject(sessionId);
  if (!found) return;
  const { project, session } = found;

  if (cliSessionId && session.cliSessionId && session.cliSessionId !== cliSessionId) return;
  if (session.userRenamed) {
    // Overwriting a manual label requires an explicit opt-in and an exact
    // thread match. An unscoped or early title cannot replace that label.
    if (session.providerId !== 'codex' || appState.preferences.codexTitleOverridesManual !== true ||
        !cliSessionId || session.cliSessionId !== cliSessionId) return;
  }
  // Claude re-sends the title on every statusLine render, and resync replays it
  // on window activate. Compare against the stored (already truncated) name so a
  // repeat doesn't cost a persist and a full tab-bar re-render.
  if (session.name === title.slice(0, MAX_SESSION_NAME_LENGTH)) return;

  appState.renameSession(project.id, sessionId, title);
}
