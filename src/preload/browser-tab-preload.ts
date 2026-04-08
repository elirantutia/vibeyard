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
let drawMode = false;
let suppressNextFlowClick = false;
let highlightOverlay: HTMLDivElement | null = null;

let drawCanvas: HTMLCanvasElement | null = null;
let drawCtx: CanvasRenderingContext2D | null = null;
let drawing = false;
let strokeCompleted = false;

function applyDrawStyles(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ff3b30';
}

function ensureDrawCanvas(): HTMLCanvasElement {
  if (!drawCanvas) {
    drawCanvas = document.createElement('canvas');
    // edit_pen icon with thick white outline for visibility on any background
    const penSvg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 -960 960 960'>" +
      "<path fill='black' stroke='white' stroke-width='90' stroke-linejoin='round' paint-order='stroke' " +
      "d='M180.18-144q-15.18 0-25.68-10.3-10.5-10.29-10.5-25.52v-86.85q0-14.33 5-27.33 5-13 16-24l477-477q11-11 23.84-16 12.83-5 27-5 14.16 0 27.16 5t24 16l51 51q11 11 16 24t5 26.54q0 14.45-5.02 27.54T795-642L318-165q-11 11-23.95 16t-27.24 5h-86.63ZM693-642l51-51-51-51-51 51 51 51Z'/>" +
      "</svg>";
    drawCanvas.style.cssText =
      'position:fixed;top:0;left:0;width:100vw;height:100vh;' +
      'z-index:2147483646;pointer-events:auto;' +
      `cursor:url("data:image/svg+xml;utf8,${penSvg}") 5 24, crosshair;` +
      'background:transparent;';
    drawCanvas.width = window.innerWidth;
    drawCanvas.height = window.innerHeight;
    document.documentElement.appendChild(drawCanvas);
    drawCtx = drawCanvas.getContext('2d');
    if (drawCtx) applyDrawStyles(drawCtx);
  }
  return drawCanvas;
}

function onDrawPointerDown(e: PointerEvent): void {
  if (!drawMode || !drawCtx) return;
  e.preventDefault();
  e.stopPropagation();
  if (strokeCompleted && drawCanvas) {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    strokeCompleted = false;
  }
  drawing = true;
  drawCtx.beginPath();
  drawCtx.moveTo(e.clientX, e.clientY);
}

function onDrawPointerMove(e: PointerEvent): void {
  if (!drawMode || !drawing || !drawCtx) return;
  e.preventDefault();
  drawCtx.lineTo(e.clientX, e.clientY);
  drawCtx.stroke();
}

function onDrawPointerUp(e: PointerEvent): void {
  if (!drawMode) return;
  e.preventDefault();
  drawing = false;
  strokeCompleted = true;
  ipcRenderer.sendToHost('draw-stroke-end', { x: e.clientX, y: e.clientY });
}

function onDrawResize(): void {
  if (!drawCanvas || !drawCtx) return;
  // Resizing a canvas clears its bitmap, so snapshot first and blit back.
  const tmp = document.createElement('canvas');
  tmp.width = drawCanvas.width;
  tmp.height = drawCanvas.height;
  tmp.getContext('2d')?.drawImage(drawCanvas, 0, 0);
  drawCanvas.width = window.innerWidth;
  drawCanvas.height = window.innerHeight;
  applyDrawStyles(drawCtx);
  drawCtx.drawImage(tmp, 0, 0);
}

function enterDrawMode(): void {
  drawMode = true;
  strokeCompleted = false;
  const canvas = ensureDrawCanvas();
  canvas.style.display = 'block';
  canvas.addEventListener('pointerdown', onDrawPointerDown, true);
  canvas.addEventListener('pointermove', onDrawPointerMove, true);
  canvas.addEventListener('pointerup', onDrawPointerUp, true);
  canvas.addEventListener('pointercancel', onDrawPointerUp, true);
  window.addEventListener('resize', onDrawResize);
}

function exitDrawMode(): void {
  drawMode = false;
  drawing = false;
  strokeCompleted = false;
  if (drawCanvas) {
    drawCanvas.removeEventListener('pointerdown', onDrawPointerDown, true);
    drawCanvas.removeEventListener('pointermove', onDrawPointerMove, true);
    drawCanvas.removeEventListener('pointerup', onDrawPointerUp, true);
    drawCanvas.removeEventListener('pointercancel', onDrawPointerUp, true);
    if (drawCtx) drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    drawCanvas.remove();
    drawCanvas = null;
    drawCtx = null;
  }
  window.removeEventListener('resize', onDrawResize);
}

function clearDrawing(): void {
  if (drawCtx && drawCanvas) {
    drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  }
  strokeCompleted = false;
}

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
  ipcRenderer.sendToHost('element-selected', { metadata, x: e.clientX, y: e.clientY });
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
ipcRenderer.on('enter-draw-mode', () => enterDrawMode());
ipcRenderer.on('exit-draw-mode', () => exitDrawMode());
ipcRenderer.on('draw-clear', () => clearDrawing());
ipcRenderer.on('flow-do-click', (_event, selector: string) => {
  const el = document.querySelector(selector);
  if (el instanceof HTMLElement) {
    suppressNextFlowClick = true;
    el.click();
  }
});
