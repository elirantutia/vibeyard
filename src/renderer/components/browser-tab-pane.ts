import { appState } from '../state.js';
import { promptNewSession } from './tab-bar.js';
import { setPendingPrompt } from './terminal-pane.js';

interface ElementInfo {
  tagName: string;
  id: string;
  classes: string[];
  textContent: string;
  selector: string;
  pageUrl: string;
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

  const selectorLine = document.createElement('div');
  selectorLine.className = 'inspect-selector-line';
  selectorLine.textContent = info.selector;
  instance.elementInfoEl.appendChild(selectorLine);

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
    `(selector: '${info.selector}'` +
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

  viewportWrapper.appendChild(viewportBtn);
  viewportWrapper.appendChild(viewportDropdown);

  const inspectBtn = document.createElement('button');
  inspectBtn.className = 'browser-inspect-btn';
  inspectBtn.textContent = 'Inspect Element';

  toolbar.appendChild(backBtn);
  toolbar.appendChild(fwdBtn);
  toolbar.appendChild(reloadBtn);
  toolbar.appendChild(urlInput);
  toolbar.appendChild(goBtn);
  toolbar.appendChild(viewportWrapper);
  toolbar.appendChild(inspectBtn);
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
      openViewportDropdown(instance);
    }
  });

  instance.viewportOutsideClickHandler = (e: MouseEvent) => {
    if (!viewportWrapper.contains(e.target as Node)) {
      closeViewportDropdown(instance);
    }
  };
  document.addEventListener('mousedown', instance.viewportOutsideClickHandler);

  inspectBtn.addEventListener('click', () => toggleInspectMode(instance));

  submitBtn.addEventListener('click', () => sendToNewSession(instance));
  customBtn.addEventListener('click', () => sendToCustomSession(instance));
  instructionInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') sendToNewSession(instance);
  });

  webview.addEventListener('did-navigate', ((e: CustomEvent) => {
    urlInput.value = e.url;
  }) as EventListener);
  webview.addEventListener('did-navigate-in-page', ((e: CustomEvent) => {
    urlInput.value = e.url;
  }) as EventListener);

  webview.addEventListener('ipc-message', ((e: CustomEvent) => {
    if (e.channel === 'element-selected') {
      showElementInfo(instance, e.args[0] as ElementInfo);
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
  // Ensure the webview guest process shuts down
  instance.webview.stop();
  instance.webview.src = 'about:blank';
  instance.element.remove();
  instances.delete(sessionId);
}

export function getBrowserTabInstance(sessionId: string): BrowserTabInstance | undefined {
  return instances.get(sessionId);
}
