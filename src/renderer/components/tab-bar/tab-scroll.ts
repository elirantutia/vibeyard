// Scroll state and decisions for the tab strip, kept DOM-free so the whole
// bank → plan → commit sequence can be unit-tested. tab-list.ts is left with
// nothing but reading and writing the offset itself.

/** What the strip last did for one project. */
interface TabScrollMemo {
  /** Active session when the strip was last auto-scrolled for this project. */
  sessionId: string | null;
  /** Where that auto-scroll left the strip. */
  autoScrollLeft: number;
  /** Where the strip actually is — a hand-scroll shows up as a divergence from
   *  autoScrollLeft, and that divergence is the whole hand-scroll signal. */
  scrollLeft: number;
}

/** What a render should do with the strip's offset. */
export interface TabScrollPlan {
  /** The offset to restore before considering the active tab. */
  scrollLeft: number;
  /** Whether the active tab may pull the strip from there. */
  autoScroll: boolean;
}

// Per-project, so switching away and back lands the strip where the user left it
// rather than replaying one global offset onto a different set of tabs. Pruned on
// 'project-removed' (see clearTabScrollState) rather than by walking the map on
// the very chatty render path.
const memos = new Map<string, TabScrollMemo>();
// Which project's offset the strip is physically showing. Not derivable from
// appState: render() runs on 'project-changed', by which point activeProject is
// already the new project while the strip still holds the old one's offset.
let renderedProjectId: string | null = null;

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
 * Whether a render may pull the active tab into view. render() fires on chatty
 * events (unread, share, status, layout), so a new active tab is the only thing
 * that justifies moving the strip outright. Beyond that we still re-correct while
 * the strip sits where we left it — that self-heals layout shifts such as provider
 * icons appearing — but once the user has scrolled it by hand, it stays put, and
 * stays put across a trip through another project.
 */
function shouldAutoScroll(memo: TabScrollMemo | undefined, sessionId: string | null): boolean {
  if (!memo) return true;
  if (memo.sessionId !== sessionId) return true;
  return memo.scrollLeft === memo.autoScrollLeft;
}

/**
 * Bank the offset the strip is showing against the project it belongs to. Call once
 * at the top of every render, before the rebuild clamps the offset to 0 and before
 * anything can return early — this is the only place a hand-scroll is observable,
 * including the one the user leaves behind on the way out of a project.
 */
export function bankScroll(scrollLeft: number): void {
  const memo = renderedProjectId ? memos.get(renderedProjectId) : undefined;
  if (memo) memo.scrollLeft = scrollLeft;
  // The strip is about to be rebuilt; only a completed render re-claims it.
  renderedProjectId = null;
}

/** Where to put this project's strip, and whether its active tab may pull it. */
export function planScroll(projectId: string, sessionId: string | null): TabScrollPlan {
  const memo = memos.get(projectId);
  return { scrollLeft: memo?.scrollLeft ?? 0, autoScroll: shouldAutoScroll(memo, sessionId) };
}

/**
 * Record where a render left the strip. Only an auto-scroll moves `autoScrollLeft`:
 * it has to keep pointing at the last position *we* chose, since that is what tells
 * a hand-scroll apart from a strip still sitting where we put it.
 */
export function commitScroll(
  projectId: string,
  sessionId: string | null,
  scrollLeft: number,
  autoScrolled: boolean,
): void {
  const memo = memos.get(projectId);
  if (memo && !autoScrolled) memo.scrollLeft = scrollLeft;
  else memos.set(projectId, { sessionId, autoScrollLeft: scrollLeft, scrollLeft });
  renderedProjectId = projectId;
}

/** Drop a closed project's remembered offset. Wired to 'project-removed'. */
export function clearTabScrollState(projectId: string): void {
  memos.delete(projectId);
  if (renderedProjectId === projectId) renderedProjectId = null;
}

export function _resetForTesting(): void {
  memos.clear();
  renderedProjectId = null;
}
