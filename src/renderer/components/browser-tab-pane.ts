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
  urlInput: HTMLInputElement;
  inspectBtn: HTMLButtonElement;
  inspectPanel: HTMLDivElement;
  instructionInput: HTMLInputElement;
  elementInfoEl: HTMLDivElement;
  inspectMode: boolean;
  selectedElement: ElementInfo | null;
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
  return (
    `Regarding the <${info.tagName}> element at ${info.pageUrl} ` +
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
  reloadBtn.className = 'browser-nav-btn';
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

  const inspectBtn = document.createElement('button');
  inspectBtn.className = 'browser-inspect-btn';
  inspectBtn.textContent = 'Inspect Element';

  toolbar.appendChild(backBtn);
  toolbar.appendChild(fwdBtn);
  toolbar.appendChild(reloadBtn);
  toolbar.appendChild(urlInput);
  toolbar.appendChild(goBtn);
  toolbar.appendChild(inspectBtn);
  el.appendChild(toolbar);

  const webview = document.createElement('webview') as unknown as WebviewElement;
  webview.className = 'browser-webview';
  webview.setAttribute('allowpopups', '');
  el.appendChild(webview);

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
    urlInput,
    inspectBtn,
    inspectPanel,
    instructionInput,
    elementInfoEl,
    inspectMode: false,
    selectedElement: null,
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
