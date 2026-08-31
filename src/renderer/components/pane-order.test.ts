import { describe, it, expect } from 'vitest';
import { isInRelativeOrder } from './pane-order';

describe('isInRelativeOrder', () => {
  it('accepts an empty wanted list', () => {
    expect(isInRelativeOrder(['a', 'b'], [])).toBe(true);
    expect(isInRelativeOrder([], [])).toBe(true);
  });

  it('accepts a contiguous run in order', () => {
    expect(isInRelativeOrder(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
  });

  it('ignores unrelated nodes interleaved between the wanted ones', () => {
    // Hidden panes stay in the container between the laid-out ones.
    expect(isInRelativeOrder(['a', 'hidden', 'b'], ['a', 'b'])).toBe(true);
  });

  it('rejects a swapped pair', () => {
    expect(isInRelativeOrder(['b', 'a'], ['a', 'b'])).toBe(false);
  });

  it('rejects a wanted node that is not a child yet', () => {
    expect(isInRelativeOrder(['a'], ['a', 'b'])).toBe(false);
  });

  it('rejects a node moved to the front of the container', () => {
    expect(isInRelativeOrder(['c', 'a', 'b'], ['a', 'b', 'c'])).toBe(false);
  });
});
