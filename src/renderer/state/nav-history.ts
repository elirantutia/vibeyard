const MAX = 50;

/**
 * Cursor over a bounded ring of recently-active session IDs. Tracks an index
 * for back/forward stepping, and a suppression flag to avoid re-pushing the
 * same id while a step is replaying it.
 *
 * Mutation, persistence, and event emission stay with the caller — this
 * class only owns the ring and the cursor.
 */
export class NavHistory {
  private history: string[] = [];
  private index = -1;
  private suppress = false;

  push(sessionId: string | null | undefined): void {
    if (!sessionId || this.suppress) return;
    if (this.history[this.index] === sessionId) return;
    this.history.length = this.index + 1;
    this.history.push(sessionId);
    if (this.history.length > MAX) {
      const drop = this.history.length - MAX;
      this.history.splice(0, drop);
    }
    this.index = this.history.length - 1;
  }

  prune(sessionId: string): void {
    let i = 0;
    while (i < this.history.length) {
      if (this.history[i] === sessionId) {
        this.history.splice(i, 1);
        if (i <= this.index) this.index--;
      } else {
        i++;
      }
    }
  }

  /**
   * Walk in `direction` from the current cursor. Drops stale entries the walk
   * passes (where `isValid` returns false). Returns the first valid id and
   * advances the cursor to it, or null if no valid entry exists.
   */
  findNextValid(direction: 1 | -1, isValid: (id: string) => boolean): string | null {
    let i = this.index + direction;
    while (i >= 0 && i < this.history.length) {
      const id = this.history[i];
      if (isValid(id)) {
        this.index = i;
        return id;
      }
      this.history.splice(i, 1);
      if (direction === -1) i--;
      if (i < this.index) this.index--;
    }
    return null;
  }

  /** Run `fn` with push() suppressed, so replaying an id doesn't re-push it. */
  withSuppression(fn: () => void): void {
    this.suppress = true;
    try {
      fn();
    } finally {
      this.suppress = false;
    }
  }
}
