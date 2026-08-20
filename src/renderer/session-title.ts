import { appState, MAX_SESSION_NAME_LENGTH } from './state.js';

/**
 * Adopt the CLI's own session name as the tab title.
 *
 * The name comes from the `session_name` field of Claude's statusLine payload:
 * the custom name set via `--name` or `/rename` when one exists, otherwise the
 * AI-generated topic title. It is absent until the session has one, so this is
 * only called with a real title.
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

  // A rename typed in Vibeyard is sticky and always wins.
  if (session.userRenamed) return;
  if (cliSessionId && session.cliSessionId && session.cliSessionId !== cliSessionId) return;
  // Claude re-sends the title on every statusLine render, and resync replays it
  // on window activate. Compare against the stored (already truncated) name so a
  // repeat doesn't cost a persist and a full tab-bar re-render.
  if (session.name === title.slice(0, MAX_SESSION_NAME_LENGTH)) return;

  appState.renameSession(project.id, sessionId, title);
}
