/** Escape a string for safe insertion into innerHTML. */
export function esc(s: string): string {
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

const AREA_LABELS: Record<string, string> = { staged: 'Staged', working: 'Changes', untracked: 'Untracked', conflicted: 'Conflicted' };

/** Return a user-friendly label for a git area value. */
export function areaLabel(area: string): string {
  return AREA_LABELS[area] || area;
}

/** Return a CSS color for a 0-100 readiness score. */
export function scoreColor(score: number): string {
  if (score >= 70) return '#34a853';
  if (score >= 40) return '#f4b400';
  return '#e94560';
}

/** Create a labeled checkbox row using the `inspect-attach-dims-row` class. */
export function createPlanModeRow(labelText: string = 'Plan mode', checked = true): { row: HTMLLabelElement; checkbox: HTMLInputElement } {
  const row = document.createElement('label');
  row.className = 'inspect-attach-dims-row';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = checked;
  const text = document.createElement('span');
  text.textContent = labelText;
  row.appendChild(checkbox);
  row.appendChild(text);
  return { row, checkbox };
}

/** Create a numeric PIN input field (4–8 digits). */
export function createPinInput(): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'share-pin-input';
  input.placeholder = 'PIN';
  input.maxLength = 8;
  input.autocomplete = 'off';
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
  });
  return input;
}
