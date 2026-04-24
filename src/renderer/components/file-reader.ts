import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { appState } from '../state.js';
import { isAbsolutePath, joinPath } from '../../shared/platform.js';
import { destroySearchBar } from './search-bar.js';
import { escapeHtml } from './dom-search-backend.js';

interface FileReaderInstance {
  element: HTMLElement;
  filePath: string;
  resolvedPath: string | null;
  loaded: boolean;
  targetLine?: number;
  viewMode: 'raw' | 'rendered';
  kind: 'text' | 'image';
  rawContent?: string;
  imageDataUrl?: string;
}

function isMarkdownFile(filePath: string): boolean {
  return /\.(md|markdown|mdown|mkd|mdx)$/i.test(filePath);
}

function isImageFile(filePath: string): boolean {
  return /\.(png|jpe?g|gif|webp|bmp|ico|svg)$/i.test(filePath);
}

const instances = new Map<string, FileReaderInstance>();
let unwatchFileChanged: (() => void) | null = null;

function renderFileContent(content: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-reader-content';

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const row = document.createElement('div');
    row.className = 'file-reader-line';

    const lineNum = document.createElement('span');
    lineNum.className = 'file-reader-line-num';
    lineNum.textContent = String(i + 1);

    const lineText = document.createElement('span');
    lineText.className = 'file-reader-line-text';
    lineText.innerHTML = escapeHtml(lines[i]) || '&nbsp;';

    row.appendChild(lineNum);
    row.appendChild(lineText);
    wrapper.appendChild(row);
  }

  return wrapper;
}

function renderMarkdownContent(content: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-reader-content file-reader-markdown';
  const rawHtml = marked.parse(content, { async: false }) as string;
  wrapper.innerHTML = DOMPurify.sanitize(rawHtml);
  return wrapper;
}

function renderImageContent(dataUrl: string, filePath: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'file-reader-image-container';
  const img = document.createElement('img');
  img.src = dataUrl;
  img.alt = filePath;
  wrapper.appendChild(img);
  return wrapper;
}

function renderBody(instance: FileReaderInstance): void {
  const body = instance.element.querySelector('.file-reader-body')!;
  // Preserve text selection if user is selecting
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && !sel.isCollapsed && body.contains(sel.anchorNode)) {
    return;
  }
  body.innerHTML = '';
  if (instance.kind === 'image') {
    if (instance.imageDataUrl) {
      body.appendChild(renderImageContent(instance.imageDataUrl, instance.filePath));
    }
    return;
  }
  if (instance.viewMode === 'rendered') {
    body.appendChild(renderMarkdownContent(instance.rawContent!));
  } else {
    body.appendChild(renderFileContent(instance.rawContent!));
  }
}

function resolveFilePath(instance: FileReaderInstance): string {
  const project = appState.activeProject;
  if (isAbsolutePath(instance.filePath)) return instance.filePath;
  return project ? joinPath(project.path, instance.filePath) : instance.filePath;
}

function showFileReaderMessage(body: Element, message: string): void {
  body.innerHTML = `<div class="file-reader-content"><div class="file-reader-line"><span class="file-reader-line-text">${message}</span></div></div>`;
}

async function loadFile(instance: FileReaderInstance): Promise<void> {
  if (instance.loaded) return;

  const project = appState.activeProject;
  if (!project) return;

  const body = instance.element.querySelector('.file-reader-body')!;
  showFileReaderMessage(body, 'Loading...');

  try {
    const fullPath = resolveFilePath(instance);
    if (instance.kind === 'image') {
      const result = await window.vibeyard.fs.readImage(fullPath);
      if (!result) {
        showFileReaderMessage(body, 'Failed to load file');
        return;
      }
      instance.imageDataUrl = result.dataUrl;
      renderBody(instance);
      instance.loaded = true;
      return;
    }
    const content = await window.vibeyard.fs.readFile(fullPath);
    instance.rawContent = content;
    renderBody(instance);
    instance.loaded = true;
    if (instance.targetLine && instance.viewMode === 'raw') {
      scrollToLine(instance);
    }
  } catch {
    showFileReaderMessage(body, 'Failed to load file');
  }
}

function ensureFileChangedListener(): void {
  if (unwatchFileChanged) return;
  unwatchFileChanged = window.vibeyard.fs.onFileChanged((changedPath: string) => {
    for (const [sessionId, instance] of instances) {
      if (instance.resolvedPath === changedPath && instance.loaded) {
        reloadFileReader(sessionId);
      }
    }
  });
}

export function reloadFileReader(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.loaded = false;
  loadFile(instance);
}

export function createFileReaderPane(sessionId: string, filePath: string, targetLine?: number): void {
  if (instances.has(sessionId)) return;

  const el = document.createElement('div');
  el.className = 'file-reader-pane';
  el.dataset.sessionId = sessionId;
  el.dataset.paneKind = 'file-reader';
  el.style.display = 'none';

  // Header
  const header = document.createElement('div');
  header.className = 'file-viewer-header';

  const pathSpan = document.createElement('span');
  pathSpan.className = 'file-viewer-path';
  pathSpan.textContent = filePath;

  const badge = document.createElement('span');
  badge.className = 'file-reader-badge';
  badge.textContent = 'READ-ONLY';

  header.appendChild(pathSpan);
  header.appendChild(badge);

  const isMd = isMarkdownFile(filePath);
  const isImage = isImageFile(filePath);
  const instance: FileReaderInstance = {
    element: el, filePath, resolvedPath: null, loaded: false, targetLine,
    viewMode: isMd ? 'rendered' : 'raw',
    kind: isImage ? 'image' : 'text',
  };

  if (isMd) {
    const toggleGroup = document.createElement('div');
    toggleGroup.className = 'file-reader-view-toggle';

    const renderedBtn = document.createElement('button');
    renderedBtn.className = 'search-toggle-btn active';
    renderedBtn.textContent = 'Rendered';
    renderedBtn.title = 'Rendered Markdown';

    const rawBtn = document.createElement('button');
    rawBtn.className = 'search-toggle-btn';
    rawBtn.textContent = 'Raw';
    rawBtn.title = 'Raw Text';

    const setMode = (mode: 'raw' | 'rendered') => {
      instance.viewMode = mode;
      renderedBtn.classList.toggle('active', mode === 'rendered');
      rawBtn.classList.toggle('active', mode === 'raw');
      if (instance.rawContent !== undefined) {
        renderBody(instance);
      }
    };

    renderedBtn.addEventListener('click', () => setMode('rendered'));
    rawBtn.addEventListener('click', () => setMode('raw'));

    toggleGroup.appendChild(renderedBtn);
    toggleGroup.appendChild(rawBtn);
    header.appendChild(toggleGroup);
  }

  el.appendChild(header);

  // Scrollable body
  const body = document.createElement('div');
  body.className = 'file-reader-body';
  el.appendChild(body);

  instances.set(sessionId, instance);
}

export function destroyFileReaderPane(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.resolvedPath) {
    window.vibeyard.fs.unwatchFile(instance.resolvedPath);
  }
  destroySearchBar(sessionId);
  destroyGoToLineBar(sessionId);
  instance.element.remove();
  instances.delete(sessionId);
}

export function showFileReaderPane(sessionId: string, isSplit: boolean): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.element.style.display = 'flex';
  if (isSplit) instance.element.classList.add('split');
  else instance.element.classList.remove('split');

  // Start watching the file for external changes
  if (!instance.resolvedPath) {
    const fullPath = resolveFilePath(instance);
    instance.resolvedPath = fullPath;
    ensureFileChangedListener();
    window.vibeyard.fs.watchFile(fullPath);
  }

  loadFile(instance);
  if (instance.loaded && instance.targetLine) {
    scrollToLine(instance);
  }
}

export function setFileReaderLine(sessionId: string, line: number): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  instance.targetLine = line;
  if (instance.loaded) {
    scrollToLine(instance);
  }
}

function scrollToLine(instance: FileReaderInstance): void {
  const line = instance.targetLine;
  if (!line) return;

  const body = instance.element.querySelector('.file-reader-body');
  if (!body) return;

  // Clear previous highlights
  body.querySelectorAll('.file-reader-line-highlight').forEach((el) => {
    el.classList.remove('file-reader-line-highlight');
  });

  const lines = body.querySelectorAll('.file-reader-line');
  const targetEl = lines[line - 1] as HTMLElement | undefined;
  if (!targetEl) return;

  targetEl.classList.add('file-reader-line-highlight');
  requestAnimationFrame(() => {
    targetEl.scrollIntoView({ block: 'center' });
  });
}

export function hideAllFileReaderPanes(): void {
  for (const instance of instances.values()) {
    instance.element.style.display = 'none';
  }
}

export function attachFileReaderToContainer(sessionId: string, container: HTMLElement): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.element.parentElement !== container) {
    container.appendChild(instance.element);
  }
}

export function getFileReaderInstance(sessionId: string): FileReaderInstance | undefined {
  return instances.get(sessionId);
}

const MARKDOWN_TEXT_SELECTOR = [
  'p', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'pre', 'blockquote',
].map((tag) => `.file-reader-markdown ${tag}`).join(', ');

const RAW_TEXT_SELECTOR = '.file-reader-line-text';

export function getFileReaderTextSelector(sessionId: string): string {
  const instance = instances.get(sessionId);
  if (!instance) return RAW_TEXT_SELECTOR;
  if (instance.kind === 'image') return '.file-reader-no-search';
  return instance.viewMode === 'rendered' ? MARKDOWN_TEXT_SELECTOR : RAW_TEXT_SELECTOR;
}

const goToLineBars = new Map<string, { bar: HTMLDivElement; input: HTMLInputElement }>();

export function showGoToLineBar(sessionId: string): void {
  const instance = instances.get(sessionId);
  if (!instance) return;
  if (instance.kind === 'image') return;
  if (instance.viewMode === 'rendered') return;

  const existing = goToLineBars.get(sessionId);
  if (existing) {
    existing.bar.classList.remove('hidden');
    existing.input.focus();
    existing.input.select();
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'goto-line-bar';

  const input = document.createElement('input');
  input.type = 'number';
  input.min = '1';
  input.placeholder = 'Go to line...';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'search-nav-btn search-close-btn';
  closeBtn.textContent = '\u2715';
  closeBtn.title = 'Close (Escape)';

  bar.appendChild(input);
  bar.appendChild(closeBtn);

  instance.element.appendChild(bar);
  goToLineBars.set(sessionId, { bar, input });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const line = parseInt(input.value, 10);
      if (line > 0) {
        setFileReaderLine(sessionId, line);
      }
      hideGoToLineBar(sessionId);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      hideGoToLineBar(sessionId);
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
      e.preventDefault();
      input.select();
    }
  });

  closeBtn.addEventListener('click', () => hideGoToLineBar(sessionId));

  input.focus();
}

export function hideGoToLineBar(sessionId: string): void {
  const entry = goToLineBars.get(sessionId);
  if (!entry) return;
  entry.bar.classList.add('hidden');
  const instance = instances.get(sessionId);
  if (instance) {
    instance.element.querySelector('.file-reader-body')?.focus();
  }
}

function destroyGoToLineBar(sessionId: string): void {
  const entry = goToLineBars.get(sessionId);
  if (!entry) return;
  entry.bar.remove();
  goToLineBars.delete(sessionId);
}
