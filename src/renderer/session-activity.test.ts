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

  it('auto-inits session if not present', () => {
    setHookStatus('s1', 'working');
    expect(getStatus('s1')).toBe('working');
  });

  it('sets completed status', () => {
    initSession('s1');
    setHookStatus('s1', 'completed');
    expect(getStatus('s1')).toBe('completed');
  });

  it('sets permission status', () => {
    initSession('s1');
    setHookStatus('s1', 'permission');
    expect(getStatus('s1')).toBe('permission');
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
    setHookStatus('s1', 'working');
    expect(getStatus('s1')).toBe('waiting');
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
