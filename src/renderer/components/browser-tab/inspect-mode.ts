import type { BrowserTabInstance, ElementInfo } from './types.js';
import { buildSelectorOptions } from './selector-ui.js';
import { positionPopover } from './popover.js';

export function toggleInspectMode(instance: BrowserTabInstance): void {
  instance.inspectMode = !instance.inspectMode;
  instance.inspectBtn.classList.toggle('active', instance.inspectMode);
  instance.recordBtn.disabled = instance.inspectMode;
  if (instance.inspectMode) {
    instance.webview.send('enter-inspect-mode');
  } else {
    instance.webview.send('exit-inspect-mode');
    instance.selectedElement = null;
    instance.inspectPanel.style.display = 'none';
  }
}

export function showElementInfo(instance: BrowserTabInstance, info: ElementInfo, x: number, y: number): void {
  instance.selectedElement = info;
  instance.inspectPanel.style.display = 'flex';
  positionPopover(instance, instance.inspectPanel, x, y);

  const classStr = info.classes.length ? `.${info.classes.join('.')}` : '';
  const idStr = info.id ? `#${info.id}` : '';
  instance.elementInfoEl.innerHTML = '';

  const tagLine = document.createElement('div');
  tagLine.className = 'inspect-tag-line';
  tagLine.textContent = `<${info.tagName}${idStr}${classStr}>`;
  instance.elementInfoEl.appendChild(tagLine);

  if (info.textContent) {
    const textLine = document.createElement('div');
    textLine.className = 'inspect-text-line';
    textLine.textContent = info.textContent;
    instance.elementInfoEl.appendChild(textLine);
  }

  const selectorLabel = document.createElement('div');
  selectorLabel.className = 'inspect-selector-label';
  selectorLabel.textContent = 'Selector';
  instance.elementInfoEl.appendChild(selectorLabel);

  const selectorOptions = buildSelectorOptions(
    info.selectors,
    info.activeSelector,
    (sel) => { instance.selectedElement!.activeSelector = sel; }
  );
  selectorOptions.className = 'inspect-selector-options';
  instance.elementInfoEl.appendChild(selectorOptions);

  instance.instructionInput.value = '';
  instance.instructionInput.focus();
}

export function buildPrompt(instance: BrowserTabInstance): string | null {
  const info = instance.selectedElement;
  if (!info) return null;
  const instruction = instance.instructionInput.value.trim();
  if (!instruction) return null;

  const vp = instance.currentViewport;
  const vpCtx = vp.width !== null ? ` [viewport: ${vp.width}×${vp.height} – ${vp.label}]` : '';

  return (
    `Regarding the <${info.tagName}> element at ${info.pageUrl}${vpCtx} ` +
    `(selector: '${info.activeSelector.value}'` +
    (info.textContent ? `, text: '${info.textContent}'` : '') +
    `): ${instruction}`
  );
}

export function dismissInspect(instance: BrowserTabInstance): void {
  instance.instructionInput.value = '';
  instance.selectedElement = null;
  instance.inspectPanel.style.display = 'none';
  if (instance.inspectMode) {
    toggleInspectMode(instance);
  }
}
