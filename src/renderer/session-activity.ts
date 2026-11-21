import { STOP_INFLIGHT_TRUST_MS } from '../shared/constants';
import type { BackgroundTask } from '../shared/types';
export type SessionStatus = 'working' | 'waiting' | 'idle' | 'completed' | 'input';

type StatusChangeCallback = (sessionId: string, status: SessionStatus) => void;

interface SessionState {
  status: SessionStatus;
  interrupted: boolean;
}

const sessions = new Map<string, SessionState>();
const listeners: StatusChangeCallback[] = [];

// Work that outlives the turn (a backgrounded shell, a monitor...). Orthogonal
// to the status: such a turn still completes, because the user is free to type,
// and the tab only marks the work. Replaced wholesale on every Stop whose list
// changed (stop_status_writer.py), so an empty list is how it clears.
const backgroundTasks = new Map<string, BackgroundTask[]>();
const backgroundListeners: ((sessionId: string) => void)[] = [];

// Backstop for the subagent-aware Stop hook (see stop_status_writer.py). When
// that hook judges work is still in flight it writes `Stop:working` instead of
// `Stop:completed`. If that in-flight signal is ever wrong the session would
// sit in 'working' forever and the real completion would never be notified.
//
// Both of the hook's branches can be wrong, in different ways:
//   - `background_tasks` (preferred): a subagent/teammate/workflow entry that
//     hangs around in the task registry holds the session indefinitely, and the
//     payload carries no per-task timestamp to age it out — so this backstop is
//     the *only* escape hatch on that path.
//   - the legacy <sid>.subagents counter (fallback, older CLIs): a lost
//     SubagentStop, a race between concurrent subagent hooks, or an
//     auto-compact SessionStart reset can leave the count too high.
//
// So: arm a fallback whenever a Stop resolves to 'working'; if the session then
// goes silent, complete it. Any later hook event counts as activity and cancels
// the pending fallback. The window matches the hook-side staleness guard
// (STOP_STALE_MS).
const STOP_FALLBACK_MS = STOP_INFLIGHT_TRUST_MS;
const stopFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();

function clearStopFallback(sessionId: string): void {
  const timer = stopFallbackTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    stopFallbackTimers.delete(sessionId);
  }
}

function setStatus(sessionId: string, status: SessionStatus): void {
  const state = sessions.get(sessionId);
  if (!state || state.status === status) return;
  state.status = status;
  for (const cb of listeners) cb(sessionId, status);
}

/**
 * Called when a hook-based status event is received from the main process.
 */
export function setHookStatus(sessionId: string, status: 'working' | 'waiting' | 'completed' | 'input', hookName?: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;  // Ignore events for sessions not managed by Vibeyard

  // Any hook event is fresh activity — cancel a pending Stop fallback. It is
  // re-armed below only if this event is itself a Stop that resolved to 'working'.
  clearStopFallback(sessionId);

  // Don't let Stop/StopFailure ('waiting') overwrite a just-set 'completed' status.
  // Completed is sticky until a new prompt ('working') or PTY exit ('idle').
  if (status === 'waiting' && state.status === 'completed') return;

  // UserPromptSubmit is a deliberate new user action — always clears the interrupt flag.
  if (hookName === 'UserPromptSubmit') state.interrupted = false;

  // Ignore stale 'working' hooks that arrive after an interrupt (e.g. PostToolUse
  // firing after the user pressed Escape and we already transitioned to 'waiting').
  if (status === 'working' && state.interrupted) return;

  // Any non-working hook clears the interrupt flag (CLI reached a definitive state).
  if (status !== 'working') state.interrupted = false;

  setStatus(sessionId, status);

  // A Stop that resolved to 'working' means the subagent-aware hook is holding
  // the session open for in-flight subagents. Arm the backstop so a wrong
  // in-flight signal can't wedge the session in 'working' indefinitely.
  if (hookName === 'Stop' && status === 'working' && sessions.get(sessionId)?.status === 'working') {
    stopFallbackTimers.set(sessionId, setTimeout(() => {
      stopFallbackTimers.delete(sessionId);
      const st = sessions.get(sessionId);
      if (st && st.status === 'working') setStatus(sessionId, 'completed');
    }, STOP_FALLBACK_MS));
  }
}

function subscribe<T>(list: T[], callback: T): () => void {
  list.push(callback);
  return () => {
    const idx = list.indexOf(callback);
    if (idx !== -1) list.splice(idx, 1);
  };
}

/**
 * Record the session's still-running background work, from the Stop hook.
 * Listeners hear only changes to what is shown (the ring or its list): the
 * marker shows only on a completed turn, and a status change already repaints.
 * The dedupe absorbs resyncAllSessions replaying an unchanged file.
 */
export function setBackgroundTasks(sessionId: string, tasks: BackgroundTask[]): void {
  if (!sessions.has(sessionId)) return;
  const prev = backgroundTasks.get(sessionId) ?? [];
  if (prev.length === 0 && tasks.length === 0) return;
  if (JSON.stringify(prev) === JSON.stringify(tasks)) return;
  const wasShown = showsBackgroundWork(sessionId);
  if (tasks.length) backgroundTasks.set(sessionId, tasks);
  else backgroundTasks.delete(sessionId);
  if (wasShown || showsBackgroundWork(sessionId)) {
    for (const cb of backgroundListeners) cb(sessionId);
  }
}

export function getBackgroundTasks(sessionId: string): BackgroundTask[] {
  return backgroundTasks.get(sessionId) ?? [];
}

/**
 * Whether to mark background work right now: only on a completed turn. The list
 * is the one the last Stop reported, so once a new turn starts (working, then
 * maybe input or an interrupt to waiting) it describes the previous turn and is
 * hidden until the next Stop replaces it. setIdle empties it on PTY exit.
 */
export function showsBackgroundWork(sessionId: string): boolean {
  return getStatus(sessionId) === 'completed' && getBackgroundTasks(sessionId).length > 0;
}

export function onBackgroundChange(callback: (sessionId: string) => void): () => void {
  return subscribe(backgroundListeners, callback);
}

export function initSession(sessionId: string): void {
  sessions.set(sessionId, { status: 'waiting', interrupted: false });
  setBackgroundTasks(sessionId, []);
  for (const cb of listeners) cb(sessionId, 'waiting');
}

export function notifyInterrupt(sessionId: string): void {
  const state = sessions.get(sessionId);
  // 'input' too: Esc on a permission prompt, an AskUserQuestion or an
  // ExitPlanMode dialog ends the turn without a Stop or PostToolUse, so
  // nothing else would clear the "needs input" state.
  if (!state || (state.status !== 'working' && state.status !== 'input')) return;
  state.interrupted = true;
  setStatus(sessionId, 'waiting');
}

export function setIdle(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  clearStopFallback(sessionId);
  setStatus(sessionId, 'idle');
  setBackgroundTasks(sessionId, []);
}

export function removeSession(sessionId: string): void {
  clearStopFallback(sessionId);
  sessions.delete(sessionId);
  backgroundTasks.delete(sessionId);
}

export function getStatus(sessionId: string): SessionStatus {
  return sessions.get(sessionId)?.status ?? 'idle';
}

export function onChange(callback: StatusChangeCallback): () => void {
  return subscribe(listeners, callback);
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  for (const timer of stopFallbackTimers.values()) clearTimeout(timer);
  stopFallbackTimers.clear();
  sessions.clear();
  listeners.length = 0;
  backgroundTasks.clear();
  backgroundListeners.length = 0;
}
