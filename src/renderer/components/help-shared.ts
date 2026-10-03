export interface IndicatorRow {
  visual: () => HTMLElement;
  label: string;
  description: string;
}

export function dot(color: string, animate?: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = 'help-dot';
  el.style.background = color;
  if (animate) el.style.animation = 'pulse 1.5s ease-in-out infinite';
  return el;
}

export function glyph(text: string, color: string, animate?: boolean): HTMLElement {
  const el = document.createElement('span');
  el.className = 'help-glyph';
  el.textContent = text;
  el.style.color = color;
  if (animate) el.style.animation = 'pulse 1.5s ease-in-out infinite';
  return el;
}

export function badge(text: string, color?: string, bgColor?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'help-badge';
  el.textContent = text;
  if (color) el.style.color = color;
  if (bgColor) el.style.background = bgColor;
  return el;
}

export function mono(text: string, color?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'help-mono';
  el.textContent = text;
  if (color) el.style.color = color;
  return el;
}

export function buildSection(title: string, rows: IndicatorRow[]): HTMLElement {
  const section = document.createElement('div');
  section.className = 'help-section';

  const header = document.createElement('div');
  header.className = 'help-section-header';
  header.textContent = title;
  section.appendChild(header);

  for (const row of rows) {
    const rowEl = document.createElement('div');
    rowEl.className = 'help-row';

    const visualEl = document.createElement('div');
    visualEl.className = 'help-visual';
    visualEl.appendChild(row.visual());

    const labelEl = document.createElement('div');
    labelEl.className = 'help-label';
    labelEl.textContent = row.label;

    const descEl = document.createElement('div');
    descEl.className = 'help-desc';
    descEl.textContent = row.description;

    rowEl.appendChild(visualEl);
    rowEl.appendChild(labelEl);
    rowEl.appendChild(descEl);
    section.appendChild(rowEl);
  }

  return section;
}
