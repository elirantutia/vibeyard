// Focus decisions for the layout, kept DOM-free so they can be unit-tested.

/** Which pane the layout last moved DOM focus to. */
export interface PaneFocusMemo {
  projectId: string;
  sessionId: string;
}

/**
 * Whether a layout render may move DOM focus into `next`'s pane.
 *
 * `renderLayout()` runs on every `session-changed` — a background statusLine tick
 * included — so only an actual change of the focused pane justifies taking focus.
 * The Cmd+F find bar lives inside the pane it searches, which makes it invisible
 * to `setFocused`'s "is focus already on a terminal" test; not calling `setFocused`
 * at all is what keeps the user's keystrokes in it.
 *
 * `focusIsIdle` (nothing focused, or the body) re-opens the door on a repeat
 * render, so focus still lands in the terminal when it is sitting nowhere.
 */
export function shouldFocusPane(
  prev: PaneFocusMemo | null,
  next: PaneFocusMemo,
  focusIsIdle: boolean,
): boolean {
  if (!prev) return true;
  if (prev.projectId !== next.projectId || prev.sessionId !== next.sessionId) return true;
  return focusIsIdle;
}
