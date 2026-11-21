// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachHoverCard, hideHoverCard } from './hover-card.js';

const card = () => document.querySelector('.hover-card') as HTMLElement | null;
const visible = () => !!card() && !card()!.classList.contains('hidden');

describe('hover card', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Only drop the targets: the module caches its card node in document.body.
    document.querySelectorAll('span').forEach((el) => el.remove());
  });
  afterEach(() => {
    hideHoverCard();
    vi.useRealTimers();
  });

  function target(): HTMLElement {
    const el = document.createElement('span');
    document.body.appendChild(el);
    return el;
  }

  it('shows static text after the hover delay and hides on mouseleave', () => {
    const el = target();
    attachHoverCard(el, 'hello');
    el.dispatchEvent(new MouseEvent('mouseenter'));
    expect(visible()).toBe(false);
    vi.advanceTimersByTime(600);
    expect(visible()).toBe(true);
    expect(card()!.textContent).toBe('hello');
    el.dispatchEvent(new MouseEvent('mouseleave'));
    expect(visible()).toBe(false);
  });

  it('evaluates function content when the card opens, not when attached', () => {
    const el = target();
    let n = 0;
    const content = vi.fn(() => `call ${++n}`);
    attachHoverCard(el, content);
    expect(content).not.toHaveBeenCalled();
    el.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(600);
    expect(card()!.textContent).toBe('call 1');
    el.dispatchEvent(new MouseEvent('mouseleave'));
    el.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(600);
    expect(card()!.textContent).toBe('call 2');
  });

  it('closes by itself when its target is removed while shown', () => {
    const el = target();
    attachHoverCard(el, 'x');
    el.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(600);
    expect(visible()).toBe(true);
    el.remove(); // a removed node fires no mouseleave
    vi.advanceTimersByTime(250);
    expect(visible()).toBe(false);
  });

  it('does not open for a target removed during the hover delay', () => {
    const el = target();
    attachHoverCard(el, 'x');
    el.dispatchEvent(new MouseEvent('mouseenter'));
    el.remove();
    vi.advanceTimersByTime(600);
    expect(visible()).toBe(false);
  });
});
