// Scroll decisions for the tab strip, kept DOM-free so they can be unit-tested.

/** What the strip was last auto-scrolled for, and where that left it. */
export interface TabScrollMemo {
  projectId: string;
  sessionId: string | null;
  scrollLeft: number;
}

/**
 * How far to scroll the strip horizontally to bring a tab fully into view, 0 when
 * it already is. The gaps are the tab's edges measured against the strip's visible
 * box: a negative `leftGap` or positive `rightGap` means it hangs off that side.
 *
 * Used instead of scrollIntoView, which also scrolls every scrollable ancestor and
 * whose `block: 'nearest'` has vertical slack to write scrollTop into — `.tab-item`
 * is `height: 100%` of the 36px strip, but the 2px horizontal scrollbar the strip
 * grows when it overflows takes that height out of its client box.
 */
export function scrollDelta(leftGap: number, rightGap: number): number {
  if (leftGap < 0) return leftGap;
  // min(): a tab wider than the strip can't fit, so stop at its left edge — the
  // name is at that end.
  if (rightGap > 0) return Math.min(rightGap, leftGap);
  return 0;
}

/**
 * Whether a re-render may pull the active tab into view. render() fires on chatty
 * events (unread, share, status, layout), so a new active tab is the only thing
 * that justifies moving the strip outright. Beyond that we still re-correct while
 * the strip sits where we left it — that self-heals layout shifts such as provider
 * icons appearing — but once the user has scrolled it by hand, it stays put.
 */
export function shouldAutoScroll(prev: TabScrollMemo | null, next: TabScrollMemo): boolean {
  if (!prev) return true;
  if (prev.projectId !== next.projectId || prev.sessionId !== next.sessionId) return true;
  return next.scrollLeft === prev.scrollLeft;
}
