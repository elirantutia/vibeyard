import { appState } from './state.js';
import { onChange, type SessionStatus } from './session-activity.js';

const previousStatus = new Map<string, SessionStatus>();
let audioCtx: AudioContext | null = null;

function playNotificationSound(): void {
  try {
    if (!audioCtx) {
      audioCtx = new AudioContext();
    }
    const ctx = audioCtx;
    const now = ctx.currentTime;

    // Short two-tone chime
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.value = 880;
    osc2.type = 'sine';
    osc2.frequency.value = 1108.73; // C#6 — a pleasant major third above A5

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);

    osc1.start(now);
    osc1.stop(now + 0.2);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.4);
  } catch {
    // Silently ignore audio errors
  }
}

export function initNotificationSound(): void {
  onChange((sessionId: string, status: SessionStatus) => {
    const prev = previousStatus.get(sessionId);
    previousStatus.set(sessionId, status);

    // Don't notify for the session the user is currently looking at
    const activeId = appState.activeProject?.activeSessionId;
    if (prev === 'working' && (status === 'waiting' || status === 'completed' || status === 'input') && appState.preferences.soundOnSessionWaiting && sessionId !== activeId) {
      playNotificationSound();
    }
  });

  // Drop the previous-status entry when a session closes (mirrors
  // notification-desktop); without this the map grows by one entry per session.
  appState.on('session-removed', (data) => {
    const sessionId = (data as { sessionId?: string })?.sessionId;
    if (sessionId) previousStatus.delete(sessionId);
  });
}
