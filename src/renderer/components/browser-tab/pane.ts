import { appState } from '../../state.js';
import { shortcutManager } from '../../shortcuts.js';
import {
  VIEWPORT_PRESETS,
  type BrowserTabInstance,
  type ElementInfo,
  type FlowPickerAction,
  type FlowPickerMetadata,
  type WebviewElement,
} from './types.js';
import { instances, getPreloadPath } from './instance.js';
import { navigateTo } from './navigation.js';
import { applyViewport, openViewportDropdown, closeViewportDropdown } from './viewport.js';
import { toggleInspectMode, showElementInfo, dismissInspect } from './inspect-mode.js';
import {
  toggleDrawMode,
  clearDrawing,
  dismissDraw,
  sendDrawToNewSession,
  sendDrawToCustomSession,
  positionDrawPopover,
} from './draw-mode.js';
import { addFlowStep, clearFlow, toggleFlowMode } from './flow-recording.js';
import { showFlowPicker, dismissFlowPicker } from './flow-picker.js';
import {
  sendFlowToCustomSession,
  sendFlowToNewSession,
  sendToCustomSession,
  sendToNewSession,
} from './session-integration.js';

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

  const drawBtn = document.createElement('button');
  drawBtn.className = 'browser-draw-btn';
  drawBtn.textContent = 'Draw';
  drawBtn.title = 'Draw on page and send annotated screenshot to AI';

  toolbar.appendChild(backBtn);
  toolbar.appendChild(fwdBtn);
  toolbar.appendChild(reloadBtn);
  toolbar.appendChild(urlInput);
  toolbar.appendChild(goBtn);
  toolbar.appendChild(viewportWrapper);
  toolbar.appendChild(inspectBtn);
  toolbar.appendChild(recordBtn);
  toolbar.appendChild(drawBtn);
  el.appendChild(toolbar);

  const viewportContainer = document.createElement('div');
  viewportContainer.className = 'browser-viewport-container responsive';

  const dragOverlay = document.createElement('div');
  dragOverlay.className = 'browser-drag-overlay';
  viewportContainer.appendChild(dragOverlay);

  const newTabPage = document.createElement('div');
  newTabPage.className = 'browser-new-tab-page';
  newTabPage.style.display = url ? 'none' : 'flex';

  const ntpLogo = document.createElement('div');
  ntpLogo.className = 'browser-ntp-logo';
  ntpLogo.textContent = 'Vibeyard';
  newTabPage.appendChild(ntpLogo);

  const ntpSubtitle = document.createElement('div');
  ntpSubtitle.className = 'browser-ntp-subtitle';
  ntpSubtitle.textContent = 'Enter a URL above to start browsing';
  newTabPage.appendChild(ntpSubtitle);

  const ntpLinks = document.createElement('div');
  ntpLinks.className = 'browser-ntp-links';
  for (const port of ['localhost:3000', 'localhost:5173', 'localhost:8080', 'localhost:4200']) {
    const btn = document.createElement('button');
    btn.className = 'browser-ntp-link';
    btn.textContent = port;
    btn.addEventListener('click', () => navigateTo(instance, port));
    ntpLinks.appendChild(btn);
  }
  newTabPage.appendChild(ntpLinks);

  viewportContainer.appendChild(newTabPage);

  const webview = document.createElement('webview') as unknown as WebviewElement;
  webview.className = 'browser-webview';
  webview.setAttribute('allowpopups', '');
  webview.setAttribute('webpreferences', 'backgroundThrottling=false');
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

  const instructionInput = document.createElement('textarea');
  instructionInput.className = 'inspect-instruction-input';
  instructionInput.rows = 3;
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
  inspectPanel.appendChild(inputRow);

  const inspectAttachDimsRow = document.createElement('label');
  inspectAttachDimsRow.className = 'inspect-attach-dims-row';
  const inspectAttachDimsCheckbox = document.createElement('input');
  inspectAttachDimsCheckbox.type = 'checkbox';
  inspectAttachDimsCheckbox.checked = true;
  const inspectAttachDimsText = document.createElement('span');
  inspectAttachDimsText.textContent = 'Attach browser dimensions to the instructions';
  inspectAttachDimsRow.appendChild(inspectAttachDimsCheckbox);
  inspectAttachDimsRow.appendChild(inspectAttachDimsText);
  inspectPanel.appendChild(inspectAttachDimsRow);

  inspectPanel.appendChild(submitGroup);
  el.appendChild(inspectPanel);

  const drawPanel = document.createElement('div');
  drawPanel.className = 'browser-inspect-panel browser-draw-panel';
  drawPanel.style.display = 'none';

  const drawHeader = document.createElement('div');
  drawHeader.className = 'inspect-tag-line';
  drawHeader.textContent = 'Draw on the page, then describe what you want.';
  drawPanel.appendChild(drawHeader);

  const drawControlsRow = document.createElement('div');
  drawControlsRow.className = 'inspect-input-row';

  const drawInstructionInput = document.createElement('textarea');
  drawInstructionInput.className = 'inspect-instruction-input';
  drawInstructionInput.rows = 3;
  drawInstructionInput.placeholder = 'Describe what you want to do\u2026';

  const drawSubmitGroup = document.createElement('div');
  drawSubmitGroup.className = 'inspect-submit-group';

  const drawClearBtn = document.createElement('button');
  drawClearBtn.className = 'inspect-clear-btn';
  drawClearBtn.textContent = 'Clear';
  drawClearBtn.title = 'Clear drawing';

  const drawSubmitBtn = document.createElement('button');
  drawSubmitBtn.className = 'inspect-submit-btn';
  drawSubmitBtn.textContent = 'Send to AI';

  const drawCustomBtn = document.createElement('button');
  drawCustomBtn.className = 'inspect-dropdown-btn';
  drawCustomBtn.textContent = '\u25BC';
  drawCustomBtn.title = 'Send to custom session';

  drawSubmitGroup.appendChild(drawSubmitBtn);
  drawSubmitGroup.appendChild(drawCustomBtn);

  const drawActions = document.createElement('div');
  drawActions.className = 'inspect-draw-actions';
  drawActions.appendChild(drawClearBtn);
  drawActions.appendChild(drawSubmitGroup);

  drawControlsRow.appendChild(drawInstructionInput);
  drawPanel.appendChild(drawControlsRow);

  const drawAttachDimsRow = document.createElement('label');
  drawAttachDimsRow.className = 'inspect-attach-dims-row';
  const drawAttachDimsCheckbox = document.createElement('input');
  drawAttachDimsCheckbox.type = 'checkbox';
  drawAttachDimsCheckbox.checked = true;
  const drawAttachDimsText = document.createElement('span');
  drawAttachDimsText.textContent = 'Attach browser dimensions to the instructions';
  drawAttachDimsRow.appendChild(drawAttachDimsCheckbox);
  drawAttachDimsRow.appendChild(drawAttachDimsText);
  drawPanel.appendChild(drawAttachDimsRow);

  const drawErrorEl = document.createElement('div');
  drawErrorEl.className = 'inspect-error-text';
  drawPanel.appendChild(drawErrorEl);

  drawPanel.appendChild(drawActions);
  el.appendChild(drawPanel);

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

  // Flow action picker popup
  const flowPickerOverlay = document.createElement('div');
  flowPickerOverlay.className = 'flow-picker-overlay';
  flowPickerOverlay.style.display = 'none';

  const flowPickerMenu = document.createElement('div');
  flowPickerMenu.className = 'flow-picker-menu';

  const pickerOptions: { label: string; sub: string; action: FlowPickerAction }[] = [
    { label: 'Click',          sub: 'Navigate without recording', action: 'click' },
    { label: 'Record',         sub: 'Capture without clicking',   action: 'record' },
    { label: 'Click + Record', sub: 'Click and add step',         action: 'click-and-record' },
  ];
  for (const opt of pickerOptions) {
    const item = document.createElement('button');
    item.className = 'flow-picker-item';
    item.dataset['action'] = opt.action;
    const labelEl = document.createElement('span');
    labelEl.className = 'flow-picker-label';
    labelEl.textContent = opt.label;
    const subEl = document.createElement('span');
    subEl.className = 'flow-picker-sub';
    subEl.textContent = opt.sub;
    item.appendChild(labelEl);
    item.appendChild(subEl);
    flowPickerMenu.appendChild(item);
  }
  flowPickerOverlay.appendChild(flowPickerMenu);
  el.appendChild(flowPickerOverlay);

  const instance: BrowserTabInstance = {
    sessionId,
    element: el,
    webview,
    viewportContainer,
    newTabPage,
    urlInput,
    inspectBtn,
    viewportBtn,
    viewportDropdown,
    inspectPanel,
    instructionInput,
    inspectAttachDimsCheckbox,
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
    flowPickerOverlay,
    flowPickerMenu,
    flowPickerPending: null,
    drawBtn,
    drawPanel,
    drawInstructionInput,
    drawAttachDimsCheckbox,
    drawErrorEl,
    drawMode: false,
  };
  instances.set(sessionId, instance);

  webview.addEventListener('before-input-event', ((e: CustomEvent & { preventDefault(): void; input: { type: string; key: string; shift: boolean; control: boolean; alt: boolean; meta: boolean } }) => {
    if (e.input.type !== 'keyDown') return;
    const synthetic = {
      key: e.input.key,
      ctrlKey: e.input.control,
      metaKey: e.input.meta,
      shiftKey: e.input.shift,
      altKey: e.input.alt,
      preventDefault: () => e.preventDefault(),
    } as KeyboardEvent;
    shortcutManager.matchEvent(synthetic);
  }) as EventListener);

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
  drawBtn.addEventListener('click', () => toggleDrawMode(instance));
  drawClearBtn.addEventListener('click', () => clearDrawing(instance));
  drawSubmitBtn.addEventListener('click', () => { void sendDrawToNewSession(instance); });
  drawCustomBtn.addEventListener('click', () => { void sendDrawToCustomSession(instance); });
  drawInstructionInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendDrawToNewSession(instance);
    } else if (e.key === 'Escape') { dismissDraw(instance); }
  });
  flowClearBtn.addEventListener('click', () => clearFlow(instance));
  flowSubmitBtn.addEventListener('click', () => sendFlowToNewSession(instance));
  flowCustomBtn.addEventListener('click', () => sendFlowToCustomSession(instance));

  flowPickerMenu.addEventListener('click', (e: MouseEvent) => {
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>('.flow-picker-item');
    if (!item || !instance.flowPickerPending) return;
    const action = item.dataset['action'] as FlowPickerAction;
    const metadata = instance.flowPickerPending;
    dismissFlowPicker(instance);
    if (action === 'click' || action === 'click-and-record') {
      instance.webview.send('flow-do-click', metadata.selectors[0]?.value ?? '');
    }
    if (action === 'record' || action === 'click-and-record') {
      addFlowStep(instance, {
        type: action === 'record' ? 'expect' : 'click',
        tagName: metadata.tagName,
        textContent: metadata.textContent,
        selectors: metadata.selectors,
        activeSelector: metadata.selectors[0],
        pageUrl: metadata.pageUrl,
      });
    }
  });

  flowPickerOverlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === flowPickerOverlay) dismissFlowPicker(instance);
  });

  submitBtn.addEventListener('click', () => sendToNewSession(instance));
  customBtn.addEventListener('click', () => sendToCustomSession(instance));
  instructionInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendToNewSession(instance);
    } else if (e.key === 'Escape') dismissInspect(instance);
  });

  function recordNavigationStep(url: string): void {
    const lastStep = instance.flowSteps[instance.flowSteps.length - 1];
    if (lastStep?.type === 'navigate' && lastStep.url === url) return;
    addFlowStep(instance, { type: 'navigate', url });
  }

  webview.addEventListener('did-navigate', ((e: CustomEvent) => {
    urlInput.value = e.url;
    newTabPage.style.display = 'none';
    appState.updateSessionBrowserTabUrl(sessionId, e.url);
    if (instance.flowMode) recordNavigationStep(e.url);
  }) as EventListener);
  webview.addEventListener('did-navigate-in-page', ((e: CustomEvent) => {
    urlInput.value = e.url;
    appState.updateSessionBrowserTabUrl(sessionId, e.url);
    if (instance.flowMode) recordNavigationStep(e.url);
  }) as EventListener);

  webview.addEventListener('ipc-message', ((e: CustomEvent) => {
    if (e.channel === 'element-selected') {
      const { metadata, x, y } = e.args[0] as { metadata: Omit<ElementInfo, 'activeSelector'>; x: number; y: number };
      const info: ElementInfo = { ...metadata, activeSelector: metadata.selectors[0] };
      showElementInfo(instance, info, x, y);
    } else if (e.channel === 'flow-element-picked') {
      const { metadata, x, y } = e.args[0] as { metadata: FlowPickerMetadata; x: number; y: number };
      showFlowPicker(instance, metadata, x, y);
    } else if (e.channel === 'draw-stroke-end') {
      const { x, y } = e.args[0] as { x: number; y: number };
      positionDrawPopover(instance, x, y);
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
  // Delete from the map first so errors below can't leave a half-destroyed instance around.
  instances.delete(sessionId);

  document.removeEventListener('mousedown', instance.viewportOutsideClickHandler);

  // <webview> calls throw if it isn't attached + dom-ready yet. Guard each
  // one individually so a failure can't skip instance.element.remove() below.
  try { if (instance.inspectMode) instance.webview.send('exit-inspect-mode'); } catch {}
  try { if (instance.flowMode) instance.webview.send('exit-flow-mode'); } catch {}
  try { if (instance.drawMode) instance.webview.send('exit-draw-mode'); } catch {}
  try { instance.webview.stop(); } catch {}
  try { instance.webview.src = 'about:blank'; } catch {}

  instance.element.remove();
}
