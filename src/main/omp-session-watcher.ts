import { createCompatibleSessionWatcher } from './pi-compatible-session-watcher';
import type { RegisterPendingOptions } from './pi-compatible-session-watcher';
import { registerTranscriptSync } from './session-transcript-sync';

/**
 * OMP has no hook system to report session IDs back to the host app.
 * Thin wrapper over the shared Pi-compatible watcher (see
 * pi-compatible-session-watcher.ts). Every launch runs with its own
 * `--session-dir`, so ownership is process-scoped: the watcher adopts a
 * transcript by its exclusive directory (and, when the id is known up
 * front, by exact id). OMP self-titles and has no status hooks, so every
 * adopted session is handed to the merged transcript-sync module, which
 * mirrors the CLI's title into the `.name` channel and the derived status
 * into the `.status` channel the tab adopts.
 */
const watcher = createCompatibleSessionWatcher({
  onAdopted: (uiSessionId, cliSessionId, projectPath, configDir, sessionDir) => {
    registerTranscriptSync(uiSessionId, 'omp', cliSessionId, projectPath, configDir, { sessionDir });
  },
});

export function startOmpSessionWatcher(): void {
  watcher.start();
}

export function registerPendingOmpSession(sessionId: string, projectPath: string, configDir: string | undefined, opts?: RegisterPendingOptions): void {
  watcher.registerPending(sessionId, projectPath, configDir, opts);
}

export function unregisterOmpSession(sessionId: string): void {
  watcher.unregister(sessionId);
}

export function stopOmpSessionWatcher(): void {
  watcher.stop();
}
