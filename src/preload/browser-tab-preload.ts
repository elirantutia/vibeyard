/**
 * Preload script injected into browser-tab <webview> guests.
 * Provides DOM element inspection: hover highlight, click to select,
 * and sends element metadata back to the host renderer via ipcRenderer.sendToHost().
 */
import { ipcRenderer } from 'electron';

interface SelectorOption {
  type: 'qa' | 'attr' | 'id' | 'css';
  label: string;
  value: string;
}

const QA_ATTRS = ['data-testid', 'data-qa', 'data-cy', 'data-test', 'data-automation', 'qaTag'];

let inspectMode = false;
let flowMode = false;
let suppressNextFlowClick = false;
let highlightOverlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (!highlightOverlay) {
    highlightOverlay = document.createElement('div');
    highlightOverlay.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483647;' +
      'border:2px solid #4a9eff;background:rgba(74,158,255,0.15);' +
      'transition:all 0.05s ease;display:none;';
    document.documentElement.appendChild(highlightOverlay);
  }
  return highlightOverlay;
}

function positionOverlay(el: Element): void {
  const overlay = ensureOverlay();
  const rect = el.getBoundingClientRect();
  overlay.style.top = `${rect.top}px`;
  overlay.style.left = `${rect.left}px`;
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;
  overlay.style.display = 'block';
}

function hideOverlay(): void {
  if (highlightOverlay) highlightOverlay.style.display = 'none';
}

function buildCssPath(el: Element): string {
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      parts.unshift(selector);
      break; // ID is unique enough
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(' > ');
}

function buildAllSelectors(el: Element): SelectorOption[] {
  const options: SelectorOption[] = [];

  const qaSet = new Set(QA_ATTRS);
  for (const attr of QA_ATTRS) {
    const val = el.getAttribute(attr);
    if (val) options.push({ type: 'qa', label: attr, value: `[${attr}="${val}"]` });
  }

  for (const attr of el.getAttributeNames()) {
    if (attr.startsWith('data-') && !qaSet.has(attr)) {
      const val = el.getAttribute(attr);
      if (val) options.push({ type: 'attr', label: attr, value: `[${attr}="${val}"]` });
    }
  }

  if (el.id) options.push({ type: 'id', label: 'id', value: `#${el.id}` });

  options.push({ type: 'css', label: 'css', value: buildCssPath(el) });

  return options;
}

function getElementMetadata(el: Element) {
  const text = (el.textContent || '').trim();
  return {
    tagName: el.tagName.toLowerCase(),
    id: el.id || '',
    classes: Array.from(el.classList),
    textContent: text.length > 150 ? text.slice(0, 150) + '\u2026' : text,
    selectors: buildAllSelectors(el),
    pageUrl: window.location.href,
  };
}

function onMouseOver(e: MouseEvent): void {
  if (!inspectMode && !flowMode) return;
  const target = e.target as Element;
  if (target === highlightOverlay) return;
  positionOverlay(target);
}

function onMouseOut(_e: MouseEvent): void {
  if (!inspectMode && !flowMode) return;
  hideOverlay();
}

function onClick(e: MouseEvent): void {
  if (!inspectMode) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  const target = e.target as Element;
  if (target === highlightOverlay) return;
  const metadata = getElementMetadata(target);
  ipcRenderer.sendToHost('element-selected', metadata);
}

function onFlowClick(e: MouseEvent): void {
  if (!flowMode) return;
  if (suppressNextFlowClick) {
    suppressNextFlowClick = false;
    return;
  }
  const target = e.target as Element;
  if (target === highlightOverlay) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  ipcRenderer.sendToHost('flow-element-picked', {
    metadata: getElementMetadata(target),
    x: e.clientX,
    y: e.clientY,
  });
}

function enterFlowMode(): void {
  flowMode = true;
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onFlowClick, true);
  document.body.style.cursor = 'crosshair';
}

function exitFlowMode(): void {
  flowMode = false;
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('mouseout', onMouseOut, true);
  document.removeEventListener('click', onFlowClick, true);
  hideOverlay();
  document.body.style.cursor = '';
}

function enterInspectMode(): void {
  inspectMode = true;
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('mouseout', onMouseOut, true);
  document.addEventListener('click', onClick, true);
  document.body.style.cursor = 'crosshair';
}

function exitInspectMode(): void {
  inspectMode = false;
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('mouseout', onMouseOut, true);
  document.removeEventListener('click', onClick, true);
  hideOverlay();
  document.body.style.cursor = '';
}

ipcRenderer.on('enter-inspect-mode', () => enterInspectMode());
ipcRenderer.on('exit-inspect-mode', () => exitInspectMode());
ipcRenderer.on('enter-flow-mode', () => enterFlowMode());
ipcRenderer.on('exit-flow-mode', () => exitFlowMode());
ipcRenderer.on('flow-do-click', (_event, selector: string) => {
  const el = document.querySelector(selector);
  if (el instanceof HTMLElement) {
    suppressNextFlowClick = true;
    el.click();
  }
});
