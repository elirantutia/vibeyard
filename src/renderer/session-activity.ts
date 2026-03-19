export type SessionStatus = 'working' | 'waiting' | 'idle' | 'completed' | 'permission';

const STALENESS_TIMEOUT_MS = 120_000;

type StatusChangeCallback = (sessionId: string, status: SessionStatus) => void;

interface SessionState {
  status: SessionStatus;
  stalenessTimer: ReturnType<typeof setTimeout> | null;
}

const sessions = new Map<string, SessionState>();
const listeners: StatusChangeCallback[] = [];

function setStatus(sessionId: string, status: SessionStatus): void {
  const state = sessions.get(sessionId);
  if (!state || state.status === status) return;
  state.status = status;
  for (const cb of listeners) cb(sessionId, status);
}

/**
 * Called when a hook-based status event is received from the main process.
 */
export function setHookStatus(sessionId: string, status: 'working' | 'waiting' | 'completed' | 'permission'): void {
  let state = sessions.get(sessionId);
  if (!state) { initSession(sessionId); state = sessions.get(sessionId)!; }

  if (state.stalenessTimer !== null) clearTimeout(state.stalenessTimer);
  state.stalenessTimer = null;

  setStatus(sessionId, status);

  if (status === 'working') {
    state.stalenessTimer = setTimeout(() => {
      state.stalenessTimer = null;
      setStatus(sessionId, 'waiting');
    }, STALENESS_TIMEOUT_MS);
  }
}

export function initSession(sessionId: string): void {
  sessions.set(sessionId, { status: 'waiting', stalenessTimer: null });
  for (const cb of listeners) cb(sessionId, 'waiting');
}

/**
 * Called when PTY data is received — keeps the session in "working" state
 * as a fallback in case fs.watch misses hook status file changes.
 * Only extends an existing "working" state; does NOT upgrade from "waiting".
 */
export function notifyPtyData(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state || state.status !== 'working') return;

  // Reset the staleness timer since we're still receiving output
  if (state.stalenessTimer !== null) clearTimeout(state.stalenessTimer);
  state.stalenessTimer = setTimeout(() => {
    state.stalenessTimer = null;
    setStatus(sessionId, 'waiting');
  }, STALENESS_TIMEOUT_MS);
}

export function setIdle(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  if (state.stalenessTimer !== null) clearTimeout(state.stalenessTimer);
  state.stalenessTimer = null;
  setStatus(sessionId, 'idle');
}

export function removeSession(sessionId: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;
  if (state.stalenessTimer !== null) clearTimeout(state.stalenessTimer);
  sessions.delete(sessionId);
}

export function getStatus(sessionId: string): SessionStatus {
  return sessions.get(sessionId)?.status ?? 'idle';
}

export function onChange(callback: StatusChangeCallback): void {
  listeners.push(callback);
}
