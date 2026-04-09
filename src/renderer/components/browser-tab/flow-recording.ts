import type { BrowserTabInstance, FlowStep } from './types.js';
import { buildSelectorOptions } from './selector-ui.js';

export function renderFlowSteps(instance: BrowserTabInstance): void {
  const list = instance.flowStepsList;
  list.innerHTML = '';

  instance.flowSteps.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'flow-step';

    const num = document.createElement('span');
    num.className = 'flow-step-number';
    num.textContent = `${i + 1}.`;

    const content = document.createElement('div');
    content.className = 'flow-step-content';

    if (step.type === 'click' || step.type === 'expect') {
      const header = document.createElement('div');
      header.className = 'flow-step-header';
      const typeBadge = document.createElement('span');
      typeBadge.className = `flow-step-type-badge flow-step-type-badge-${step.type}`;
      typeBadge.textContent = step.type;
      const tag = document.createElement('span');
      tag.className = 'flow-step-tag';
      tag.textContent = `<${step.tagName}>`;
      const desc = document.createElement('span');
      desc.textContent = step.textContent ? ` "${step.textContent}"` : '';
      header.appendChild(typeBadge);
      header.appendChild(tag);
      header.appendChild(desc);
      content.appendChild(header);

      if (step.selectors?.length) {
        const selectorOptions = buildSelectorOptions(
          step.selectors,
          step.activeSelector,
          (sel) => { step.activeSelector = sel; }
        );
        selectorOptions.className = 'flow-step-selectors';
        content.appendChild(selectorOptions);
      }
    } else {
      const urlSpan = document.createElement('span');
      urlSpan.className = 'flow-step-url';
      urlSpan.textContent = `\u2192 ${step.url}`;
      content.appendChild(urlSpan);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'flow-step-remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.title = 'Remove step';
    removeBtn.addEventListener('click', () => {
      instance.flowSteps.splice(i, 1);
      renderFlowSteps(instance);
    });

    row.appendChild(num);
    row.appendChild(content);
    row.appendChild(removeBtn);
    list.appendChild(row);
  });

  const hasSteps = instance.flowSteps.length > 0;
  instance.flowPanel.style.display = (instance.flowMode || hasSteps) ? 'flex' : 'none';
  instance.flowInputRow.style.display = hasSteps ? 'flex' : 'none';
  instance.flowPanelLabel.textContent = `Flow (${instance.flowSteps.length} steps)`;
}

export function addFlowStep(instance: BrowserTabInstance, step: FlowStep): void {
  instance.flowSteps.push(step);
  renderFlowSteps(instance);
}

export function toggleFlowMode(instance: BrowserTabInstance): void {
  instance.flowMode = !instance.flowMode;
  instance.recordBtn.classList.toggle('active', instance.flowMode);
  instance.recordBtn.textContent = instance.flowMode ? '\u25A0 Stop' : '\u25CF Record';

  instance.inspectBtn.disabled = instance.flowMode;
  instance.drawBtn.disabled = instance.flowMode;
  if (instance.flowMode) {
    instance.webview.send('enter-flow-mode');
    instance.flowPanel.style.display = 'flex';
  } else {
    instance.webview.send('exit-flow-mode');
    if (instance.flowSteps.length === 0) {
      instance.flowPanel.style.display = 'none';
    }
  }
}

export function clearFlow(instance: BrowserTabInstance): void {
  instance.flowSteps = [];
  instance.flowInstructionInput.value = '';
  renderFlowSteps(instance);
}

export function dismissFlow(instance: BrowserTabInstance): void {
  if (instance.flowMode) toggleFlowMode(instance);
  clearFlow(instance);
}

export function buildFlowPrompt(instance: BrowserTabInstance): string | null {
  if (instance.flowSteps.length === 0) return null;
  const instruction = instance.flowInstructionInput.value.trim();
  if (!instruction) return null;

  const lines = instance.flowSteps.map((step, i) => {
    const n = i + 1;
    if (step.type === 'click' || step.type === 'expect') {
      const tag = `<${step.tagName}>`;
      const text = step.textContent ? ` "${step.textContent}"` : '';
      const at = step.pageUrl ? ` at ${step.pageUrl}` : '';
      const sel = step.activeSelector ? `\n   selector: '${step.activeSelector.value}'` : '';
      const verb = step.type === 'expect' ? 'Assert/Expect' : 'Click';
      return `${n}. ${verb}: ${tag}${text}${at}${sel}`;
    } else {
      return `${n}. Navigate to: ${step.url}`;
    }
  });

  return (
    `Recorded browser flow (${instance.flowSteps.length} steps):\n` +
    lines.join('\n') +
    `\n\nInstructions: ${instruction}`
  );
}
