export function createWidgetEmpty(label: string, ctaLabel: string, onCta: () => void): HTMLElement {
  const empty = document.createElement('div');
  empty.className = 'widget-empty';

  const text = document.createElement('div');
  text.textContent = label;
  empty.appendChild(text);

  const cta = document.createElement('button');
  cta.className = 'btn-secondary btn-sm';
  cta.textContent = ctaLabel;
  cta.addEventListener('click', onCta);
  empty.appendChild(cta);

  return empty;
}
