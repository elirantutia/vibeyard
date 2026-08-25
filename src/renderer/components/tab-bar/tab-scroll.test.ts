import { describe, it, expect } from 'vitest';
import { scrollDelta, shouldAutoScroll, type TabScrollMemo } from './tab-scroll';

describe('scrollDelta', () => {
  it('stays put when the tab is fully inside the strip', () => {
    expect(scrollDelta(0, -100)).toBe(0);
    expect(scrollDelta(120, -40)).toBe(0);
    expect(scrollDelta(0, 0)).toBe(0);
  });

  it('scrolls back by the overhang when the tab is off the left edge', () => {
    expect(scrollDelta(-120, -220)).toBe(-120);
  });

  it('scrolls forward by the overhang when the tab is off the right edge', () => {
    expect(scrollDelta(200, 100)).toBe(100);
  });

  it('stops at the left edge for a tab wider than the strip', () => {
    expect(scrollDelta(50, 300)).toBe(50);
  });

  it('handles sub-pixel overhangs', () => {
    expect(scrollDelta(-0.5, -60)).toBe(-0.5);
    expect(scrollDelta(40, 0.5)).toBe(0.5);
  });
});

describe('shouldAutoScroll', () => {
  const prev: TabScrollMemo = { projectId: 'p1', sessionId: 's1', scrollLeft: 400 };
  const at = (scrollLeft: number, over: Partial<TabScrollMemo> = {}): TabScrollMemo =>
    ({ projectId: 'p1', sessionId: 's1', scrollLeft, ...over });

  it('scrolls on the first render', () => {
    expect(shouldAutoScroll(null, at(0))).toBe(true);
  });

  it('scrolls when the active session changed', () => {
    expect(shouldAutoScroll(prev, at(999, { sessionId: 's2' }))).toBe(true);
  });

  it('scrolls when the project changed', () => {
    expect(shouldAutoScroll(prev, at(999, { projectId: 'p2' }))).toBe(true);
  });

  it('re-corrects the same tab while the strip is where we left it', () => {
    // Self-heals layout shifts: provider icons appearing, a tab closing to the left.
    expect(shouldAutoScroll(prev, at(400))).toBe(true);
  });

  it('stays put once the user has scrolled the strip by hand', () => {
    expect(shouldAutoScroll(prev, at(120))).toBe(false);
  });

  it('treats a project with no active session as its own identity', () => {
    const none: TabScrollMemo = { projectId: 'p1', sessionId: null, scrollLeft: 0 };
    expect(shouldAutoScroll(none, at(0))).toBe(true);
    expect(shouldAutoScroll(none, at(0, { sessionId: null }))).toBe(true);
    expect(shouldAutoScroll(none, at(50, { sessionId: null }))).toBe(false);
  });
});
