import {
  initSession,
  setHookStatus,
  notifyInterrupt,
  setIdle,
  removeSession,
  getStatus,
  onChange,
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

  it('does nothing when not in working state', () => {
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
