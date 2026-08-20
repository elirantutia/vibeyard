import { STOP_INFLIGHT_TRUST_MS } from '../shared/constants';
export type SessionStatus = 'working' | 'waiting' | 'idle' | 'completed' | 'input';

type StatusChangeCallback = (sessionId: string, status: SessionStatus) => void;

interface SessionState {
  status: SessionStatus;
  interrupted: boolean;
}

const sessions = new Map<string, SessionState>();
const listeners: StatusChangeCallback[] = [];

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

export function initSession(sessionId: string): void {
  sessions.set(sessionId, { status: 'waiting', interrupted: false });
  for (const cb of listeners) cb(sessionId, 'waiting');
}

export function notifyInterrupt(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state || state.status !== 'working') return;
  state.interrupted = true;
  setStatus(sessionId, 'waiting');
}

export function setIdle(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  clearStopFallback(sessionId);
  setStatus(sessionId, 'idle');
}

export function removeSession(sessionId: string): void {
  clearStopFallback(sessionId);
  sessions.delete(sessionId);
}

export function getStatus(sessionId: string): SessionStatus {
  return sessions.get(sessionId)?.status ?? 'idle';
}

export function onChange(callback: StatusChangeCallback): () => void {
  listeners.push(callback);
  return () => {
    const idx = listeners.indexOf(callback);
    if (idx !== -1) listeners.splice(idx, 1);
  };
}

/** @internal Test-only: reset all module state */
export function _resetForTesting(): void {
  for (const timer of stopFallbackTimers.values()) clearTimeout(timer);
  stopFallbackTimers.clear();
  sessions.clear();
  listeners.length = 0;
}
