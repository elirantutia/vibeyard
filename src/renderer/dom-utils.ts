/** Escape a string for safe insertion into innerHTML. */
export function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

/** Return a CSS color for a 0-100 readiness score. */
export function scoreColor(score: number): string {
  if (score >= 70) return '#34a853';
  if (score >= 40) return '#f4b400';
  return '#e94560';
}
