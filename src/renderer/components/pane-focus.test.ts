import { describe, it, expect } from 'vitest';
import { shouldFocusPane, type PaneFocusMemo } from './pane-focus';

describe('shouldFocusPane', () => {
  const prev: PaneFocusMemo = { projectId: 'p1', sessionId: 's1' };

  it('focuses on the first render', () => {
    expect(shouldFocusPane(null, prev, false)).toBe(true);
  });

  it('focuses when the session or the project changed', () => {
    expect(shouldFocusPane(prev, { projectId: 'p1', sessionId: 's2' }, false)).toBe(true);
    expect(shouldFocusPane(prev, { projectId: 'p2', sessionId: 's1' }, false)).toBe(true);
  });

  it('leaves focus alone on a repeat render', () => {
    // The find bar the user is typing into lives inside the pane, so setFocused
    // cannot tell it from the terminal — this is where it is protected.
    expect(shouldFocusPane(prev, { ...prev }, false)).toBe(false);
  });

  it('reclaims focus on a repeat render when nothing holds it', () => {
    expect(shouldFocusPane(prev, { ...prev }, true)).toBe(true);
  });
});
