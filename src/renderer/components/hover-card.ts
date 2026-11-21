let cardEl: HTMLDivElement | null = null;
let escHandler: ((e: KeyboardEvent) => void) | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
/** Polls whether the card's target left the DOM while shown: a removed node fires no mouseleave. */
let detachTimer: ReturnType<typeof setInterval> | null = null;
const HOVER_DELAY_MS = 600;
const DETACH_POLL_MS = 250;

function ensureCard(): HTMLDivElement {
  if (cardEl) return cardEl;
  const el = document.createElement('div');
  el.className = 'hover-card hidden';
  el.setAttribute('role', 'tooltip');
  document.body.appendChild(el);
  cardEl = el;
  return el;
}

function show(target: HTMLElement, content: string): void {
  // The target may have been removed (tab closed, row re-rendered) during the hover delay.
  if (!target.isConnected) return;
  const card = ensureCard();
  card.textContent = content;
  card.classList.remove('hidden');

  const rect = target.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const margin = 8;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  let top = rect.bottom + margin;
  let left = rect.left + rect.width / 2 - cardRect.width / 2;
  if (top + cardRect.height > viewportH - margin) {
    top = rect.top - cardRect.height - margin;
  }
  if (left + cardRect.width > viewportW - margin) {
    left = viewportW - cardRect.width - margin;
  }
  if (left < margin) left = margin;

  card.style.top = `${Math.max(margin, top)}px`;
  card.style.left = `${left}px`;

  if (!detachTimer) {
    detachTimer = setInterval(() => { if (!target.isConnected) hide(); }, DETACH_POLL_MS);
  }

  if (!escHandler) {
    escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    document.addEventListener('keydown', escHandler);
  }
}

function hide(): void {
  if (detachTimer) {
    clearInterval(detachTimer);
    detachTimer = null;
  }
  if (showTimer) {
    clearTimeout(showTimer);
    showTimer = null;
  }
  if (cardEl) cardEl.classList.add('hidden');
  if (escHandler) {
    document.removeEventListener('keydown', escHandler);
    escHandler = null;
  }
}

function scheduleShow(target: HTMLElement, content: string | (() => string)): void {
  if (showTimer) clearTimeout(showTimer);
  showTimer = setTimeout(() => {
    showTimer = null;
    show(target, typeof content === 'function' ? content() : content);
  }, HOVER_DELAY_MS);
}

export function hideHoverCard(): void {
  hide();
}

/**
 * `content` is plain text; `\n` breaks lines. It may be a function, evaluated each time
 * the card opens, for text that goes stale (countdowns). The card closes by itself if
 * `target` is removed from the DOM, so callers need no cleanup on re-render.
 */
export function attachHoverCard(target: HTMLElement, content: string | (() => string)): void {
  target.addEventListener('mouseenter', () => scheduleShow(target, content));
  target.addEventListener('focusin', () => scheduleShow(target, content));
  target.addEventListener('mouseleave', hide);
  target.addEventListener('focusout', hide);
}
