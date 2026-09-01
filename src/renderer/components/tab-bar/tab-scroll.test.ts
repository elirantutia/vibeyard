import { describe, it, expect, beforeEach } from 'vitest';
import {
  scrollDelta,
  bankScroll,
  planScroll,
  commitScroll,
  clearTabScrollState,
  _resetForTesting,
} from './tab-scroll';

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

describe('tab strip scroll state', () => {
  beforeEach(_resetForTesting);

  /**
   * One render() of `project`/`session`, standing in for the DOM: the strip is at
   * `at` when the render starts, and an auto-scroll moves it to `autoScrollTo`.
   * Returns the plan the render acted on and where it left the strip.
   */
  function render(project: string, session: string | null, at: number, autoScrollTo = at) {
    bankScroll(at);
    const plan = planScroll(project, session);
    const settled = plan.autoScroll ? autoScrollTo : plan.scrollLeft;
    commitScroll(project, session, settled, plan.autoScroll);
    return { ...plan, settled };
  }

  it('pulls the active tab into view on a project first render', () => {
    expect(render('p1', 's1', 0, 400)).toMatchObject({ scrollLeft: 0, autoScroll: true, settled: 400 });
  });

  it('re-corrects the same tab while the strip is where we left it', () => {
    // Self-heals layout shifts: provider icons appearing, a tab closing to the left.
    render('p1', 's1', 0, 400);
    expect(render('p1', 's1', 400, 380).autoScroll).toBe(true);
  });

  it('stays put once the user has scrolled the strip by hand', () => {
    render('p1', 's1', 0, 400);
    expect(render('p1', 's1', 120)).toMatchObject({ scrollLeft: 120, autoScroll: false, settled: 120 });
  });

  it('pulls a newly activated tab into view even after a hand-scroll', () => {
    render('p1', 's1', 0, 400);
    render('p1', 's1', 120);
    expect(render('p1', 's2', 120, 900).autoScroll).toBe(true);
  });

  it('restores a hand-scrolled offset after a trip through another project', () => {
    render('p1', 's1', 0, 400);
    render('p1', 's1', 120);        // user drags the strip
    render('p2', 's9', 120, 700);   // switch away — p1's offset is banked on the way out
    expect(render('p1', 's1', 700)).toMatchObject({ scrollLeft: 120, autoScroll: false, settled: 120 });
  });

  it('restores each project to its own offset', () => {
    render('p1', 's1', 0, 400);
    render('p2', 's9', 400, 700);
    render('p2', 's9', 700);        // p2 settles where the auto-scroll put it
    expect(render('p1', 's1', 700).scrollLeft).toBe(400);
    expect(render('p2', 's9', 400).scrollLeft).toBe(700);
  });

  it('scrolls a returning project whose active tab changed while away', () => {
    render('p1', 's1', 0, 400);
    render('p1', 's1', 120);
    render('p2', 's9', 120, 700);
    // s1 was closed while p1 was off screen, so nothing would be highlighted.
    expect(render('p1', 's2', 700, 260)).toMatchObject({ scrollLeft: 120, autoScroll: true, settled: 260 });
  });

  it('does not misattribute an offset banked with no project on screen', () => {
    render('p1', 's1', 0, 400);
    bankScroll(400);                // render() with no active project: banks, then bails
    expect(render('p2', 's9', 0, 700).scrollLeft).toBe(0);
    expect(planScroll('p1', 's1').scrollLeft).toBe(400);
  });

  it('forgets a removed project, and re-renders it from scratch if the id returns', () => {
    render('p1', 's1', 0, 400);
    render('p1', 's1', 120);
    clearTabScrollState('p1');
    expect(render('p1', 's1', 120, 400)).toMatchObject({ scrollLeft: 0, autoScroll: true });
  });

  it('treats a project with no active session as its own identity', () => {
    expect(render('p1', null, 0, 0).autoScroll).toBe(true);
    expect(render('p1', null, 50).autoScroll).toBe(false);
    expect(render('p1', 's1', 50, 300).autoScroll).toBe(true);
  });
});
