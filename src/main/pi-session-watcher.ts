import { createCompatibleSessionWatcher } from './pi-compatible-session-watcher';
import type { RegisterPendingOptions } from './pi-compatible-session-watcher';
import { registerTranscriptSync } from './session-transcript-sync';

/**
 * Pi has no hook system to report session IDs back to the host app.
 * Thin wrapper over the shared Pi-compatible watcher (see
 * pi-compatible-session-watcher.ts). Every launch runs with its own
 * `--session-dir`, so ownership is process-scoped: the watcher adopts a
 * transcript by its exclusive directory (and, when the id is known up
 * front, by exact id).
 */
const watcher = createCompatibleSessionWatcher({
  onAdopted: (uiSessionId, cliSessionId, projectPath, configDir, sessionDir) =>
    registerTranscriptSync(uiSessionId, 'pi', cliSessionId, projectPath, configDir, { sessionDir }),
});

export function startPiSessionWatcher(): void {
  watcher.start();
}

export function registerPendingPiSession(sessionId: string, projectPath: string, configDir: string | undefined, opts?: RegisterPendingOptions): void {
  watcher.registerPending(sessionId, projectPath, configDir, opts);
}

export function unregisterPiSession(sessionId: string): void {
  watcher.unregister(sessionId);
}

export function stopPiSessionWatcher(): void {
  watcher.stop();
}
