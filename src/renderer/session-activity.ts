export type SessionStatus = 'working' | 'waiting' | 'idle' | 'completed' | 'input';

type StatusChangeCallback = (sessionId: string, status: SessionStatus) => void;

interface SessionState {
  status: SessionStatus;
  interrupted: boolean;
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
export function setHookStatus(sessionId: string, status: 'working' | 'waiting' | 'completed' | 'input', hookName?: string): void {
  const state = sessions.get(sessionId);
  if (!state) return;  // Ignore events for sessions not managed by Vibeyard

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
  setStatus(sessionId, 'idle');
}

export function removeSession(sessionId: string): void {
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
  sessions.clear();
  listeners.length = 0;
}
