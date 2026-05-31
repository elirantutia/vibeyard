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
