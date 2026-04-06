import { appState } from '../state.js';
import { promptNewSession } from './tab-bar.js';
import { setPendingPrompt } from './terminal-pane.js';

interface SelectorOption {
  type: 'qa' | 'attr' | 'id' | 'css';
  label: string;
  value: string;
}

type ActiveSelector = SelectorOption;

interface ElementInfo {
  tagName: string;
  id: string;
  classes: string[];
  textContent: string;
  selectors: SelectorOption[];
  activeSelector: ActiveSelector;
  pageUrl: string;
}

interface FlowStep {
  type: 'click' | 'navigate';
  tagName?: string;
  textContent?: string;
  selector?: string;
  pageUrl?: string;
  url?: string;
}

interface ViewportPreset {
  label: string;
  width: number | null;
  height: number | null;
}

const VIEWPORT_PRESETS: ViewportPreset[] = [
  { label: 'Responsive', width: null, height: null },
  { label: 'iPhone SE',  width: 375,  height: 667  },
  { label: 'iPhone 14',  width: 393,  height: 852  },
  { label: 'Pixel 7',    width: 412,  height: 915  },
  { label: 'iPad Air',   width: 820,  height: 1180 },
  { label: 'iPad Pro',   width: 1024, height: 1366 },
];

interface WebviewElement extends HTMLElement {
  src: string;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  send(channel: string, ...args: unknown[]): void;
}

interface BrowserTabInstance {
  element: HTMLDivElement;
  webview: WebviewElement;
  viewportContainer: HTMLDivElement;
  urlInput: HTMLInputElement;
  inspectBtn: HTMLButtonElement;
  viewportBtn: HTMLButtonElement;
  viewportDropdown: HTMLDivElement;
  inspectPanel: HTMLDivElement;
  instructionInput: HTMLInputElement;
  elementInfoEl: HTMLDivElement;
  inspectMode: boolean;
  selectedElement: ElementInfo | null;
  currentViewport: ViewportPreset;
  viewportOutsideClickHandler: (e: MouseEvent) => void;
  recordBtn: HTMLButtonElement;
  flowPanel: HTMLDivElement;
  flowPanelLabel: HTMLSpanElement;
  flowStepsList: HTMLDivElement;
  flowInputRow: HTMLDivElement;
  flowInstructionInput: HTMLTextAreaElement;
  flowMode: boolean;
  flowSteps: FlowStep[];
}

const instances = new Map<string, BrowserTabInstance>();
let preloadPathPromise: Promise<string> | null = null;

function getPreloadPath(): Promise<string> {
  if (!preloadPathPromise) {
    preloadPathPromise = window.vibeyard.app.getBrowserPreloadPath();
  }
  return preloadPathPromise;
}

function navigateTo(instance: BrowserTabInstance, url: string): void {
  let normalizedUrl = url.trim();
  if (normalizedUrl && !/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = 'http://' + normalizedUrl;
  }
  if (!normalizedUrl) return;
  instance.urlInput.value = normalizedUrl;
  instance.webview.src = normalizedUrl;
}

function toggleInspectMode(instance: BrowserTabInstance): void {
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

function applyViewport(instance: BrowserTabInstance, preset: ViewportPreset): void {
  instance.currentViewport = preset;

  const label = preset.width !== null ? `${preset.width}×${preset.height}` : 'Responsive';
  instance.viewportBtn.textContent = label;
  instance.viewportBtn.classList.toggle('active', preset.width !== null);

  const webviewEl = instance.webview as unknown as HTMLElement;
  if (preset.width !== null) {
    instance.viewportContainer.classList.remove('responsive');
    webviewEl.style.width = `${preset.width}px`;
    webviewEl.style.height = `${preset.height}px`;
    webviewEl.style.flex = 'none';
  } else {
    instance.viewportContainer.classList.add('responsive');
    webviewEl.style.width = '';
    webviewEl.style.height = '';
    webviewEl.style.flex = '';
  }
}

function openViewportDropdown(instance: BrowserTabInstance): void {
  instance.viewportDropdown.classList.add('visible');
}

function closeViewportDropdown(instance: BrowserTabInstance): void {
  instance.viewportDropdown.classList.remove('visible');
}

function showElementInfo(instance: BrowserTabInstance, info: ElementInfo): void {
  instance.selectedElement = info;
  instance.inspectPanel.style.display = 'flex';

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

  const selectorOptions = document.createElement('div');
  selectorOptions.className = 'inspect-selector-options';

  const allOptionEls: HTMLElement[] = [];

  function activateOption(chosen: SelectorOption): void {
    instance.selectedElement!.activeSelector = chosen;
    allOptionEls.forEach((el) => el.classList.remove('active'));
    const idx = info.selectors.indexOf(chosen);
    if (idx >= 0) allOptionEls[idx].classList.add('active');
  }

  for (const sel of info.selectors) {
    const row = document.createElement('div');
    row.className = 'inspect-selector-option';
    if (sel === info.activeSelector) row.classList.add('active');

    const badge = document.createElement('span');
    badge.className = `selector-badge selector-badge-${sel.type}`;
    badge.textContent = sel.type;

    const valueSpan = document.createElement('span');
    valueSpan.className = 'selector-value';
    valueSpan.textContent = sel.value;

    row.appendChild(badge);
    row.appendChild(valueSpan);
    allOptionEls.push(row);
    selectorOptions.appendChild(row);

    row.addEventListener('click', () => activateOption(sel));
  }

  instance.elementInfoEl.appendChild(selectorOptions);

  instance.instructionInput.value = '';
  instance.instructionInput.focus();
}

function buildPrompt(instance: BrowserTabInstance): string | null {
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

function dismissInspect(instance: BrowserTabInstance): void {
  instance.instructionInput.value = '';
  instance.selectedElement = null;
  instance.inspectPanel.style.display = 'none';
  if (instance.inspectMode) {
    toggleInspectMode(instance);
  }
}

function renderFlowSteps(instance: BrowserTabInstance): void {
  const list = instance.flowStepsList;
  list.innerHTML = '';

  instance.flowSteps.forEach((step, i) => {
    const row = document.createElement('div');
    row.className = 'flow-step';

    const num = document.createElement('span');
    num.className = 'flow-step-number';
    num.textContent = `${i + 1}.`;

    const content = document.createElement('span');
    content.className = 'flow-step-content';

    if (step.type === 'click') {
      const tag = document.createElement('span');
      tag.className = 'flow-step-tag';
      tag.textContent = `<${step.tagName}>`;
      const desc = document.createElement('span');
      desc.textContent = step.textContent ? ` "${step.textContent}"` : '';
      content.appendChild(tag);
      content.appendChild(desc);
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

function addFlowStep(instance: BrowserTabInstance, step: FlowStep): void {
  instance.flowSteps.push(step);
  renderFlowSteps(instance);
}

function toggleFlowMode(instance: BrowserTabInstance): void {
  instance.flowMode = !instance.flowMode;
  instance.recordBtn.classList.toggle('active', instance.flowMode);
  instance.recordBtn.textContent = instance.flowMode ? '\u25A0 Stop' : '\u25CF Record';

  if (instance.flowMode) {
    instance.inspectBtn.disabled = true;
    instance.webview.send('enter-flow-mode');
    instance.flowPanel.style.display = 'flex';
  } else {
    instance.inspectBtn.disabled = false;
    instance.webview.send('exit-flow-mode');
    if (instance.flowSteps.length === 0) {
      instance.flowPanel.style.display = 'none';
    }
  }
}

function clearFlow(instance: BrowserTabInstance): void {
  instance.flowSteps = [];
  instance.flowInstructionInput.value = '';
  renderFlowSteps(instance);
}

function dismissFlow(instance: BrowserTabInstance): void {
  if (instance.flowMode) toggleFlowMode(instance);
  clearFlow(instance);
}

function buildFlowPrompt(instance: BrowserTabInstance): string | null {
  if (instance.flowSteps.length === 0) return null;
  const instruction = instance.flowInstructionInput.value.trim();
  if (!instruction) return null;

  const lines = instance.flowSteps.map((step, i) => {
    const n = i + 1;
    if (step.type === 'click') {
      const tag = `<${step.tagName}>`;
      const text = step.textContent ? ` "${step.textContent}"` : '';
      const at = step.pageUrl ? ` at ${step.pageUrl}` : '';
      const sel = `\n   selector: '${step.selector}'`;
      return `${n}. Click: ${tag}${text}${at}${sel}`;
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

function sendFlowToNewSession(instance: BrowserTabInstance): void {
  const instruction = instance.flowInstructionInput.value.trim();
  const prompt = buildFlowPrompt(instance);
  if (!prompt) return;
  const project = appState.activeProject;
  if (!project) return;

  const newSession = appState.addSession(project.id, `Flow: ${instruction.slice(0, 30)}`);
  if (newSession) {
    setPendingPrompt(newSession.id, prompt);
  }
  dismissFlow(instance);
}

function sendFlowToCustomSession(instance: BrowserTabInstance): void {
  const prompt = buildFlowPrompt(instance);
  if (!prompt) return;

  promptNewSession((session) => {
    setPendingPrompt(session.id, prompt);
    dismissFlow(instance);
  });
}

function sendToNewSession(instance: BrowserTabInstance): void {
  const info = instance.selectedElement;
  const prompt = buildPrompt(instance);
  if (!info || !prompt) return;
  const project = appState.activeProject;
  if (!project) return;

  const sessionName = `${info.tagName}: ${instance.instructionInput.value.trim().slice(0, 30)}`;
  const newSession = appState.addSession(project.id, sessionName);
  if (newSession) {
    setPendingPrompt(newSession.id, prompt);
  }
  dismissInspect(instance);
}

function sendToCustomSession(instance: BrowserTabInstance): void {
  const prompt = buildPrompt(instance);
  if (!prompt) return;

  promptNewSession((session) => {
    setPendingPrompt(session.id, prompt);
    dismissInspect(instance);
  });
}

export function createBrowserTabPane(sessionId: string, url?: string): void {
  if (instances.has(sessionId)) return;

  const el = document.createElement('div');
  el.className = 'browser-tab-pane hidden';

  const toolbar = document.createElement('div');
  toolbar.className = 'browser-tab-toolbar';

  const backBtn = document.createElement('button');
  backBtn.className = 'browser-nav-btn';
  backBtn.textContent = '\u25C0';
  backBtn.title = 'Back';

  const fwdBtn = document.createElement('button');
  fwdBtn.className = 'browser-nav-btn';
  fwdBtn.textContent = '\u25B6';
  fwdBtn.title = 'Forward';

  const reloadBtn = document.createElement('button');
  reloadBtn.className = 'browser-nav-btn browser-reload-btn';
  reloadBtn.textContent = '\u21BB';
  reloadBtn.title = 'Reload';

  const urlInput = document.createElement('input');
  urlInput.className = 'browser-url-input';
  urlInput.type = 'text';
  urlInput.placeholder = 'Enter URL (e.g. localhost:3000)';
  urlInput.value = url || '';

  const goBtn = document.createElement('button');
  goBtn.className = 'browser-go-btn';
  goBtn.textContent = 'Go';

  // Viewport picker button + dropdown
  const viewportWrapper = document.createElement('div');
  viewportWrapper.className = 'browser-viewport-wrapper';

  const viewportBtn = document.createElement('button');
  viewportBtn.className = 'browser-viewport-btn';
  viewportBtn.textContent = 'Responsive';
  viewportBtn.title = 'Change viewport size';

  const viewportDropdown = document.createElement('div');
  viewportDropdown.className = 'browser-viewport-dropdown';

  for (const preset of VIEWPORT_PRESETS) {
    const item = document.createElement('div');
    item.className = 'browser-viewport-item';
    item.textContent = preset.width !== null
      ? `${preset.label} — ${preset.width}×${preset.height}`
      : preset.label;
    item.addEventListener('click', () => {
      applyViewport(instance, preset);
      closeViewportDropdown(instance);
    });
    viewportDropdown.appendChild(item);
  }

  const customItem = document.createElement('div');
  customItem.className = 'browser-viewport-item browser-viewport-item-custom';
  customItem.textContent = 'Custom\u2026';
  viewportDropdown.appendChild(customItem);

  const customForm = document.createElement('div');
  customForm.className = 'browser-viewport-custom';

  const customWInput = document.createElement('input');
  customWInput.type = 'number';
  customWInput.className = 'browser-viewport-custom-input';
  customWInput.placeholder = 'W';
  customWInput.min = '1';

  const customSep = document.createElement('span');
  customSep.className = 'browser-viewport-custom-sep';
  customSep.textContent = '\u00D7';

  const customHInput = document.createElement('input');
  customHInput.type = 'number';
  customHInput.className = 'browser-viewport-custom-input';
  customHInput.placeholder = 'H';
  customHInput.min = '1';

  const customApplyBtn = document.createElement('button');
  customApplyBtn.className = 'browser-viewport-custom-apply';
  customApplyBtn.textContent = 'Apply';

  customForm.appendChild(customWInput);
  customForm.appendChild(customSep);
  customForm.appendChild(customHInput);
  customForm.appendChild(customApplyBtn);
  viewportDropdown.appendChild(customForm);

  viewportWrapper.appendChild(viewportBtn);
  viewportWrapper.appendChild(viewportDropdown);

  const inspectBtn = document.createElement('button');
  inspectBtn.className = 'browser-inspect-btn';
  inspectBtn.textContent = 'Inspect Element';

  const recordBtn = document.createElement('button');
  recordBtn.className = 'browser-record-btn';
  recordBtn.textContent = '\u25CF Record';
  recordBtn.title = 'Record browser flow';

  toolbar.appendChild(backBtn);
  toolbar.appendChild(fwdBtn);
  toolbar.appendChild(reloadBtn);
  toolbar.appendChild(urlInput);
  toolbar.appendChild(goBtn);
  toolbar.appendChild(viewportWrapper);
  toolbar.appendChild(inspectBtn);
  toolbar.appendChild(recordBtn);
  el.appendChild(toolbar);

  const viewportContainer = document.createElement('div');
  viewportContainer.className = 'browser-viewport-container responsive';

  const dragOverlay = document.createElement('div');
  dragOverlay.className = 'browser-drag-overlay';
  viewportContainer.appendChild(dragOverlay);

  const webview = document.createElement('webview') as unknown as WebviewElement;
  webview.className = 'browser-webview';
  webview.setAttribute('allowpopups', '');
  viewportContainer.appendChild(webview);
  el.appendChild(viewportContainer);

  const inspectPanel = document.createElement('div');
  inspectPanel.className = 'browser-inspect-panel';
  inspectPanel.style.display = 'none';

  const elementInfoEl = document.createElement('div');
  elementInfoEl.className = 'inspect-element-info';
  inspectPanel.appendChild(elementInfoEl);

  const inputRow = document.createElement('div');
  inputRow.className = 'inspect-input-row';

  const instructionInput = document.createElement('input');
  instructionInput.className = 'inspect-instruction-input';
  instructionInput.type = 'text';
  instructionInput.placeholder = 'Describe what you want to do\u2026';

  const submitGroup = document.createElement('div');
  submitGroup.className = 'inspect-submit-group';

  const submitBtn = document.createElement('button');
  submitBtn.className = 'inspect-submit-btn';
  submitBtn.textContent = 'Send to AI';

  const customBtn = document.createElement('button');
  customBtn.className = 'inspect-dropdown-btn';
  customBtn.textContent = '\u25BC';
  customBtn.title = 'Send to custom session';

  submitGroup.appendChild(submitBtn);
  submitGroup.appendChild(customBtn);

  inputRow.appendChild(instructionInput);
  inputRow.appendChild(submitGroup);
  inspectPanel.appendChild(inputRow);
  el.appendChild(inspectPanel);

  // Flow Panel
  const flowPanel = document.createElement('div');
  flowPanel.className = 'browser-flow-panel';
  flowPanel.style.display = 'none';

  const flowHeader = document.createElement('div');
  flowHeader.className = 'flow-panel-header';

  const flowLabel = document.createElement('span');
  flowLabel.className = 'flow-panel-label';
  flowLabel.textContent = 'Flow (0 steps)';

  const flowClearBtn = document.createElement('button');
  flowClearBtn.className = 'flow-panel-clear-btn';
  flowClearBtn.textContent = 'Clear';

  flowHeader.appendChild(flowLabel);
  flowHeader.appendChild(flowClearBtn);
  flowPanel.appendChild(flowHeader);

  const flowStepsList = document.createElement('div');
  flowStepsList.className = 'flow-steps-list';
  flowPanel.appendChild(flowStepsList);

  const flowInputRow = document.createElement('div');
  flowInputRow.className = 'flow-input-row';
  flowInputRow.style.display = 'none';

  const flowInstructionInput = document.createElement('textarea');
  flowInstructionInput.className = 'flow-instruction-input';
  flowInstructionInput.placeholder = 'Describe what to do with this flow\u2026';
  flowInstructionInput.rows = 2;

  const flowSubmitGroup = document.createElement('div');
  flowSubmitGroup.className = 'inspect-submit-group';

  const flowSubmitBtn = document.createElement('button');
  flowSubmitBtn.className = 'inspect-submit-btn';
  flowSubmitBtn.textContent = 'Send to AI';

  const flowCustomBtn = document.createElement('button');
  flowCustomBtn.className = 'inspect-dropdown-btn';
  flowCustomBtn.textContent = '\u25BC';
  flowCustomBtn.title = 'Send to custom session';

  flowSubmitGroup.appendChild(flowSubmitBtn);
  flowSubmitGroup.appendChild(flowCustomBtn);
  flowInputRow.appendChild(flowInstructionInput);
  flowInputRow.appendChild(flowSubmitGroup);
  flowPanel.appendChild(flowInputRow);
  el.appendChild(flowPanel);

  const instance: BrowserTabInstance = {
    element: el,
    webview,
    viewportContainer,
    urlInput,
    inspectBtn,
    viewportBtn,
    viewportDropdown,
    inspectPanel,
    instructionInput,
    elementInfoEl,
    inspectMode: false,
    selectedElement: null,
    currentViewport: VIEWPORT_PRESETS[0],
    viewportOutsideClickHandler: () => {},
    recordBtn,
    flowPanel,
    flowPanelLabel: flowLabel,
    flowStepsList,
    flowInputRow,
    flowInstructionInput,
    flowMode: false,
    flowSteps: [],
  };
  instances.set(sessionId, instance);

  // Preload must be set before src to ensure the inspect script is injected
  getPreloadPath().then((p) => {
    webview.setAttribute('preload', `file://${p}`);
    if (url) webview.src = url;
  });

  backBtn.addEventListener('click', () => webview.goBack());
  fwdBtn.addEventListener('click', () => webview.goForward());
  reloadBtn.addEventListener('click', () => webview.reload());

  goBtn.addEventListener('click', () => navigateTo(instance, urlInput.value));
  urlInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') navigateTo(instance, urlInput.value);
  });

  viewportBtn.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    if (viewportDropdown.classList.contains('visible')) {
      closeViewportDropdown(instance);
    } else {
      customForm.style.display = 'none';
      openViewportDropdown(instance);
    }
  });

  instance.viewportOutsideClickHandler = (e: MouseEvent) => {
    if (!viewportWrapper.contains(e.target as Node)) {
      closeViewportDropdown(instance);
    }
  };
  document.addEventListener('mousedown', instance.viewportOutsideClickHandler);

  customItem.addEventListener('click', () => {
    customForm.style.display = 'flex';
    customWInput.focus();
  });

  function applyCustomSize(): void {
    const w = parseInt(customWInput.value, 10);
    const h = parseInt(customHInput.value, 10);
    if (w > 0 && h > 0) {
      applyViewport(instance, { label: 'Custom', width: w, height: h });
      closeViewportDropdown(instance);
    }
  }

  customApplyBtn.addEventListener('click', applyCustomSize);
  customWInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') applyCustomSize(); });
  customHInput.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') applyCustomSize(); });

  inspectBtn.addEventListener('click', () => toggleInspectMode(instance));
  recordBtn.addEventListener('click', () => toggleFlowMode(instance));
  flowClearBtn.addEventListener('click', () => clearFlow(instance));
  flowSubmitBtn.addEventListener('click', () => sendFlowToNewSession(instance));
  flowCustomBtn.addEventListener('click', () => sendFlowToCustomSession(instance));

  submitBtn.addEventListener('click', () => sendToNewSession(instance));
  customBtn.addEventListener('click', () => sendToCustomSession(instance));
  instructionInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') sendToNewSession(instance);
  });

  function recordNavigationStep(url: string): void {
    const lastStep = instance.flowSteps[instance.flowSteps.length - 1];
    if (lastStep?.type === 'navigate' && lastStep.url === url) return;
    addFlowStep(instance, { type: 'navigate', url });
  }

  webview.addEventListener('did-navigate', ((e: CustomEvent) => {
    urlInput.value = e.url;
    if (instance.flowMode) recordNavigationStep(e.url);
  }) as EventListener);
  webview.addEventListener('did-navigate-in-page', ((e: CustomEvent) => {
    urlInput.value = e.url;
    if (instance.flowMode) recordNavigationStep(e.url);
  }) as EventListener);

  webview.addEventListener('ipc-message', ((e: CustomEvent) => {
    if (e.channel === 'element-selected') {
      const metadata = e.args[0] as Omit<ElementInfo, 'activeSelector'>;
      const info: ElementInfo = { ...metadata, activeSelector: metadata.selectors[0] };
      showElementInfo(instance, info);
    } else if (e.channel === 'flow-click') {
      const metadata = e.args[0] as { tagName: string; textContent: string; selectors: SelectorOption[]; pageUrl: string };
      addFlowStep(instance, {
        type: 'click',
        tagName: metadata.tagName,
        textContent: metadata.textContent,
        selector: metadata.selectors[0].value,
        pageUrl: metadata.pageUrl,
      });
    }
  }) as EventListener);
}

export function attachBrowserTabToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function showBrowserTabPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.classList.remove('hidden');
  instance.element.classList.toggle('split', isSplit);
}

export function hideAllBrowserTabPanes(): void {
  for (const instance of instances.values()) {
    instance.element.classList.add('hidden');
  }
}

export function destroyBrowserTabPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  document.removeEventListener('mousedown', instance.viewportOutsideClickHandler);
  if (instance.inspectMode) {
    instance.webview.send('exit-inspect-mode');
  }
  if (instance.flowMode) {
    instance.webview.send('exit-flow-mode');
  }
  // Ensure the webview guest process shuts down
  instance.webview.stop();
  instance.webview.src = 'about:blank';
  instance.element.remove();
  instances.delete(sessionId);
}

export function getBrowserTabInstance(sessionId: string): BrowserTabInstance | undefined {
  return instances.get(sessionId);
}
