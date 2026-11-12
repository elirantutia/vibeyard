/** Build a `modal-toggle-field` row: a label paired with a checkbox. */
export function toggleRow(id: string, labelText: string, checked: boolean): { row: HTMLDivElement; checkbox: HTMLInputElement } {
  const row = document.createElement('div');
  row.className = 'modal-toggle-field';

  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = labelText;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = id;
  checkbox.checked = checked;

  row.appendChild(label);
  row.appendChild(checkbox);
  return { row, checkbox };
}

/** Build a `preferences-subheading` divider that labels a group of rows. */
export function subheading(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'preferences-subheading';
  el.textContent = text;
  return el;
}

/** Build a `preferences-section-desc` paragraph explaining the row above it. */
export function sectionDesc(text: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'preferences-section-desc';
  el.textContent = text;
  return el;
}
