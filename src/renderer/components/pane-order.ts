// DOM-order decisions for the layout, kept DOM-free so they can be unit-tested.

/**
 * Whether `wanted` already sits inside `children` in that relative order — i.e.
 * whether a layout pass needs to move any pane at all.
 *
 * Only the *relative* order matters: hidden panes stay in the container and sit
 * interleaved with the laid-out ones, so a `previousSibling` comparison would
 * report a false mismatch and re-append every pane on every render.
 */
export function isInRelativeOrder<T>(children: readonly T[], wanted: readonly T[]): boolean {
  let last = -1;
  for (const item of wanted) {
    const index = children.indexOf(item);
    if (index === -1 || index < last) return false;
    last = index;
  }
  return true;
}
