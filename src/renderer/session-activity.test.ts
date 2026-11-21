import {
  initSession,
  setHookStatus,
  notifyInterrupt,
  setIdle,
  removeSession,
  getStatus,
  onChange,
  setBackgroundTasks,
  getBackgroundTasks,
  showsBackgroundWork,
  onBackgroundChange,
  _resetForTesting,
} from './session-activity';

beforeEach(() => {
  _resetForTesting();
});

describe('initSession', () => {
  it('sets status to waiting', () => {
    initSession('s1');
    expect(getStatus('s1')).toBe('waiting');
  });

  it('notifies listeners', () => {
    const cb = vi.fn();
    onChange(cb);
    initSession('s1');
    expect(cb).toHaveBeenCalledWith('s1', 'waiting');
  });
});

describe('setHookStatus', () => {
  it('sets working status', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    expect(getStatus('s1')).toBe('working');
  });

  it('ignores hook events for unknown sessions', () => {
    setHookStatus('s1', 'working');
    expect(getStatus('s1')).toBe('idle');
  });

  it('sets completed status', () => {
    initSession('s1');
    setHookStatus('s1', 'completed');
    expect(getStatus('s1')).toBe('completed');
  });

  it('sets input status', () => {
    initSession('s1');
    setHookStatus('s1', 'input');
    expect(getStatus('s1')).toBe('input');
  });

  it('does not overwrite completed with waiting', () => {
    initSession('s1');
    setHookStatus('s1', 'completed');
    setHookStatus('s1', 'waiting');
    expect(getStatus('s1')).toBe('completed');
  });

  it('allows working to overwrite completed (new prompt)', () => {
    initSession('s1');
    setHookStatus('s1', 'completed');
    setHookStatus('s1', 'working');
    expect(getStatus('s1')).toBe('working');
  });

  it('does not notify if status unchanged', () => {
    initSession('s1');
    setHookStatus('s1', 'waiting');
    const cb = vi.fn();
    onChange(cb);
    setHookStatus('s1', 'waiting');
    expect(cb).not.toHaveBeenCalled();
  });
});

describe('notifyInterrupt', () => {
  it('transitions from working to waiting', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    notifyInterrupt('s1');
    expect(getStatus('s1')).toBe('waiting');
  });

  // Esc on a permission prompt / AskUserQuestion / ExitPlanMode ends the turn
  // with no Stop or PostToolUse, so the interrupt is the only way out of 'input'.
  it('clears a pending input prompt', () => {
    initSession('s1');
    setHookStatus('s1', 'input', 'PreToolUse');
    notifyInterrupt('s1');
    expect(getStatus('s1')).toBe('waiting');
  });

  it('does nothing when not in working or input state', () => {
    initSession('s1');
    notifyInterrupt('s1');
    expect(getStatus('s1')).toBe('waiting');

    setHookStatus('s1', 'completed');
    notifyInterrupt('s1');
    expect(getStatus('s1')).toBe('completed');
  });

  it('does nothing for unknown session', () => {
    notifyInterrupt('unknown'); // should not throw
    expect(getStatus('unknown')).toBe('idle');
  });

  it('ignores stale working hooks after interrupt', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    notifyInterrupt('s1');
    expect(getStatus('s1')).toBe('waiting');

    // A stale PostToolUse 'working' hook arrives after the interrupt
    setHookStatus('s1', 'working', 'PostToolUse');
    expect(getStatus('s1')).toBe('waiting');
  });

  it('allows UserPromptSubmit to override interrupted state', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    notifyInterrupt('s1');
    expect(getStatus('s1')).toBe('waiting');

    // User submits a new prompt — should clear interrupted and transition to working
    setHookStatus('s1', 'working', 'UserPromptSubmit');
    expect(getStatus('s1')).toBe('working');
  });

  it('clears interrupted flag on non-working hook status', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    notifyInterrupt('s1');

    // CLI fires a definitive 'completed' — clears the interrupted flag
    setHookStatus('s1', 'completed');
    expect(getStatus('s1')).toBe('completed');

    // Now a new 'working' prompt should be accepted again
    setHookStatus('s1', 'working');
    expect(getStatus('s1')).toBe('working');
  });
});

describe('setIdle', () => {
  it('sets idle status', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    setIdle('s1');
    expect(getStatus('s1')).toBe('idle');
  });

  it('does nothing for unknown session', () => {
    setIdle('unknown'); // should not throw
  });
});

describe('getStatus', () => {
  it('returns idle for unknown session', () => {
    expect(getStatus('unknown')).toBe('idle');
  });
});

describe('removeSession', () => {
  it('removes session', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    removeSession('s1');
    expect(getStatus('s1')).toBe('idle'); // defaults to idle when not found
  });

  it('does nothing for unknown session', () => {
    removeSession('unknown'); // should not throw
  });
});

describe('onChange unsubscribe', () => {
  it('stops receiving callbacks after unsubscribe', () => {
    initSession('s1');
    const cb = vi.fn();
    const unsub = onChange(cb);

    setHookStatus('s1', 'working');
    expect(cb).toHaveBeenCalledTimes(1);

    unsub();
    setHookStatus('s1', 'waiting');
    expect(cb).toHaveBeenCalledTimes(1); // no new calls after unsub
  });

  it('only removes the specific subscriber', () => {
    initSession('s1');
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const unsub1 = onChange(cb1);
    onChange(cb2);

    unsub1();
    setHookStatus('s1', 'working');

    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

// The subagent-aware Stop hook writes `Stop:working` (not `completed`) while it
// believes subagents are in flight. If that signal is wrong the session must
// still eventually complete — these cover the renderer backstop that guarantees it.
describe('Stop-resolved-working fallback', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('completes a session left in working by a Stop, after silence', () => {
    initSession('s1');
    setHookStatus('s1', 'working', 'UserPromptSubmit');
    // A Stop that resolved to working (subagents believed in flight).
    setHookStatus('s1', 'working', 'Stop');
    expect(getStatus('s1')).toBe('working');

    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(getStatus('s1')).toBe('completed');
  });

  it('does not fire the fallback when a real completion arrives first', () => {
    initSession('s1');
    setHookStatus('s1', 'working', 'Stop');
    setHookStatus('s1', 'completed', 'Stop');
    expect(getStatus('s1')).toBe('completed');

    // The completion cancelled the fallback; it must not re-fire later.
    const cb = vi.fn();
    onChange(cb);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(cb).not.toHaveBeenCalled();
    expect(getStatus('s1')).toBe('completed');
  });

  it('is cancelled by ongoing subagent activity (a later working hook)', () => {
    initSession('s1');
    setHookStatus('s1', 'working', 'Stop');
    // A subagent tool finishes: PostToolUse working — activity, resets the timer.
    vi.advanceTimersByTime(9 * 60 * 1000);
    setHookStatus('s1', 'working', 'PostToolUse');
    // Original 10-min mark passes without a fire because it was reset.
    vi.advanceTimersByTime(2 * 60 * 1000);
    expect(getStatus('s1')).toBe('working');
  });

  it('only arms for Stop, not for a plain working hook', () => {
    initSession('s1');
    setHookStatus('s1', 'working', 'PostToolUse');
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(getStatus('s1')).toBe('working');
  });

  it('is cleared when the session goes idle before firing', () => {
    initSession('s1');
    setHookStatus('s1', 'working', 'Stop');
    setIdle('s1');
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(getStatus('s1')).toBe('idle');
  });
});

describe('background tasks', () => {
  const shell = { type: 'shell', description: 'npm run dev' };

  it('marks background work only once the turn is over', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    setBackgroundTasks('s1', [shell]);
    expect(showsBackgroundWork('s1')).toBe(false);
    setHookStatus('s1', 'completed', 'Stop');
    expect(showsBackgroundWork('s1')).toBe(true);
    expect(getBackgroundTasks('s1')).toEqual([shell]);
  });

  it('hides the previous turn\'s list once a new turn asks for input or is interrupted', () => {
    initSession('s1');
    setHookStatus('s1', 'completed', 'Stop');
    setBackgroundTasks('s1', [shell]);
    setHookStatus('s1', 'working', 'UserPromptSubmit');
    setHookStatus('s1', 'input', 'PermissionRequest');
    expect(showsBackgroundWork('s1')).toBe(false);
    notifyInterrupt('s1');
    expect(showsBackgroundWork('s1')).toBe(false);
  });

  it('clears on an empty list, notifying only on change', () => {
    initSession('s1');
    setHookStatus('s1', 'completed', 'Stop');
    const cb = vi.fn();
    onBackgroundChange(cb);
    setBackgroundTasks('s1', [shell]);
    setBackgroundTasks('s1', [{ ...shell }]);
    expect(cb).toHaveBeenCalledTimes(1);
    setBackgroundTasks('s1', []);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(getBackgroundTasks('s1')).toEqual([]);
  });

  it('stays quiet about changes nobody can see mid-turn', () => {
    initSession('s1');
    setHookStatus('s1', 'working');
    const cb = vi.fn();
    onBackgroundChange(cb);
    setBackgroundTasks('s1', [shell]);
    expect(cb).not.toHaveBeenCalled();
    expect(getBackgroundTasks('s1')).toEqual([shell]);
  });

  it('drops the work when the CLI exits, and ignores unknown sessions', () => {
    initSession('s1');
    setHookStatus('s1', 'completed', 'Stop');
    setBackgroundTasks('s1', [shell]);
    setIdle('s1');
    expect(getBackgroundTasks('s1')).toEqual([]);
    expect(showsBackgroundWork('s1')).toBe(false);

    setBackgroundTasks('ghost', [shell]);
    expect(getBackgroundTasks('ghost')).toEqual([]);
  });

  it('starts empty for a re-initialised session', () => {
    initSession('s1');
    setBackgroundTasks('s1', [shell]);
    initSession('s1');
    expect(getBackgroundTasks('s1')).toEqual([]);
  });
});
